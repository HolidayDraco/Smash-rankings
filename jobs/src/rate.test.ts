import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDb,
  events,
  ingestRuns,
  leaderboard,
  meta,
  players,
  ratingHistory,
  sets,
  standings,
  tournaments,
  type Database,
} from "@sr/db";
import { runMigrations } from "@sr/db/migrate";
import { periodIndexFor, periodStart } from "@sr/ranking";
import { discover } from "./discover";
import { parseJobArgs, runDbJob, runJob } from "./harness";
import { rateJob, type RateHooks } from "./rate";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const NOW = Date.parse("2026-10-03T12:00:00Z");
const WEEK_MS = 7 * 86_400_000;
const P = periodIndexFor(new Date(NOW));

describe("rate job flags and env", () => {
  it("parses --as-of", () => {
    expect(parseJobArgs(["--as-of", "2026-09-01"]).asOf).toEqual(new Date("2026-09-01"));
    // Manual diagnostic only: --as-of never writes.
    expect(parseJobArgs(["--as-of", "2026-09-01"]).dryRun).toBe(true);
  });
  it("scrubs DATABASE_URL from ctx.redact and from the failure message", async () => {
    const url = "postgres://127.0.0.1:1/sr-fake-db-marker";
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let redacted = "";
    try {
      const code = await runDbJob(
        "rate",
        ["--dry-run"],
        async (ctx) => {
          redacted = ctx.redact(new Error(`could not reach ${url}`));
          throw new Error(`boom ${url}`);
        },
        { env: { DATABASE_URL: url } },
      );
      expect(code).toBe(1);
      const printed = stderr.mock.calls.map(([text]) => String(text)).join("");
      expect(printed).toContain("rate failed");
      for (const text of [redacted, printed]) expect(text).not.toContain("sr-fake-db-marker");
    } finally {
      stderr.mockRestore();
    }
  });
  it("needs DATABASE_URL but never STARTGG_TOKEN", async () => {
    const code = await runDbJob("rate", [], rateJob(), { env: { STARTGG_TOKEN: "x" } });
    expect(code).toBe(2);
  });
  it("rejects --as-of on start.gg jobs with a usage error", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const code = await runJob("discover", ["--as-of", "2026-09-01"], discover, {
        env: { STARTGG_TOKEN: "x" },
      });
      expect(code).toBe(2);
      expect(String(stderr.mock.calls[0]?.[0])).toContain("--as-of is only for the rate job");
    } finally {
      stderr.mockRestore();
    }
  });
});

// CI must always run the database tests; a silent skip would hide a broken setup.
if (process.env.CI && !testDatabaseUrl) throw new Error("TEST_DATABASE_URL must be set in CI");

interface SetSpec {
  winner: number;
  loser: number;
  event: number;
  period: number | null;
  isDq?: boolean;
  /** Minutes after the period's Monday 00:00 UTC. */
  minute?: number;
}

describe.skipIf(!testDatabaseUrl)(
  "rate job (skipped: TEST_DATABASE_URL is not set; CI always sets it)",
  () => {
    let db: Database;
    let close: () => Promise<void>;
    let nextSetId = 1;
    const env = { DATABASE_URL: testDatabaseUrl };

    const completedAt = (period: number, minute = 0) =>
      new Date(periodStart(period).getTime() + (10 * 60 + minute) * 60_000);

    async function addPlayers(ids: number[], mergedInto: number | null = null) {
      await db
        .insert(players)
        .values(ids.map((id) => ({ id, gamerTag: `P${id}`, countryCode: "US", region: "CA" })))
        .onConflictDoNothing();
      if (mergedInto !== null) {
        for (const id of ids)
          await db.update(players).set({ mergedInto }).where(eq(players.id, id));
      }
    }
    async function addEvent(id: number, period: number, qualifies = true) {
      await db.insert(events).values({
        id,
        tournamentId: 1,
        slug: `e${id}`,
        name: `E${id}`,
        qualifies,
        startAt: periodStart(period),
      });
    }
    async function addSets(specs: SetSpec[]) {
      const rows = specs.map((s) => ({
        id: nextSetId++,
        eventId: s.event,
        winnerId: s.winner,
        loserId: s.loser,
        isDq: s.isDq ?? false,
        ratingPeriod: s.period,
        completedAt: completedAt(s.period ?? P, s.minute),
      }));
      const entries = [
        ...new Set(specs.flatMap((s) => [`${s.event}:${s.winner}`, `${s.event}:${s.loser}`])),
      ].map((entry, i) => {
        const [eventId, playerId] = entry.split(":").map(Number);
        return { eventId: eventId!, playerId: playerId!, placement: i + 1 };
      });
      for (let i = 0; i < rows.length; i += 1000) {
        await db.insert(sets).values(rows.slice(i, i + 1000));
      }
      for (let i = 0; i < entries.length; i += 1000) {
        await db
          .insert(standings)
          .values(entries.slice(i, i + 1000))
          .onConflictDoNothing();
      }
    }

    /** 8 core players play a round robin every week for 6 weeks before P (events 101–106). */
    const CORE = [1, 2, 3, 4, 5, 6, 7, 8];
    async function seedCore() {
      await addPlayers(CORE);
      for (let w = 1; w <= 6; w += 1) {
        const period = P - w;
        await addEvent(100 + w, period);
        const specs: SetSpec[] = [];
        for (const a of CORE)
          for (const b of CORE)
            if (a < b) {
              const aWins = (a * b + w) % 3 !== 0; // lower ids win more often
              specs.push({
                winner: aWins ? a : b,
                loser: aWins ? b : a,
                event: 100 + w,
                period,
                minute: a * 10 + b,
              });
            }
        await addSets(specs);
      }
    }

    const run = async (argv: string[] = [], now = NOW, hooks: RateHooks = {}, extraEnv = {}) => {
      const out: string[] = [];
      const code = await runDbJob("rate", argv, rateJob(hooks), {
        env: { ...env, ...extraEnv },
        now: () => now,
        out: (line) => out.push(line),
      });
      expect(code).toBe(0);
      return out.join("\n");
    };
    const board = () =>
      db
        .select()
        .from(leaderboard)
        .orderBy(sql`${leaderboard.rank} asc nulls last`, asc(leaderboard.playerId));
    const history = () =>
      db
        .select()
        .from(ratingHistory)
        .orderBy(asc(ratingHistory.playerId), asc(ratingHistory.period));
    const metaValue = async (key: string) =>
      (await db.select().from(meta).where(eq(meta.key, key)))[0]?.value;

    beforeAll(async () => {
      if (!testDatabaseUrl) return;
      if (/neon\.tech/i.test(testDatabaseUrl)) throw new Error("Use a disposable database.");
      ({ db, close } = createDb(testDatabaseUrl, { maxConnections: 1 }));
      await db.execute(sql`drop schema if exists drizzle cascade`);
      await db.execute(sql`drop schema if exists public cascade`);
      await db.execute(sql`create schema public`);
      await runMigrations(db);
    }, 30_000);
    beforeEach(async () => {
      for (const table of [
        leaderboard,
        ratingHistory,
        standings,
        sets,
        events,
        tournaments,
        meta,
        ingestRuns,
      ])
        await db.delete(table);
      await db.update(players).set({ mergedInto: null });
      await db.delete(players);
      await db.insert(tournaments).values({ id: 1, slug: "t1", name: "T1" });
      await seedCore();
    });
    afterAll(async () => {
      await close?.();
    });

    it("ranks the core, writes one ingest_runs row, and reports its runtime", async () => {
      const out = await run();
      const rows = await board();
      expect(rows.filter((r) => r.eligible)).toHaveLength(8);
      expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(rows[0]).toMatchObject({
        playerId: 1,
        setsPlayed: 42,
        eventsPlayed: 6,
        region: "CA",
        countryCode: "US",
      });
      expect(out).toMatch(/runtime \d+\.\d\d s/);
      expect(out).toContain("| Rank | Player |");
      const runs = await db.select().from(ingestRuns);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ job: "rate", status: "success", eventsTouched: 6 });
    });

    it("gives an identical leaderboard and history on a rerun, and bumps data_version", async () => {
      await run();
      const [firstBoard, firstHistory] = [await board(), await history()];
      expect(await metaValue("data_version")).toBe("1");
      const out = await run();
      expect(await board()).toEqual(firstBoard);
      expect(await history()).toEqual(firstHistory);
      expect(out).toContain("(0 written, 0 removed)");
      expect(await metaValue("data_version")).toBe("2");
      expect(await metaValue("last_rated_at")).toBe(new Date(NOW).toISOString());
    });

    it("does not rate DQs or sets from non-qualifying (online) events", async () => {
      await run();
      const before = await board();
      await addEvent(300, P - 1, false);
      await addSets([
        ...Array.from({ length: 20 }, () => ({ winner: 8, loser: 1, event: 300, period: P - 1 })),
        { winner: 8, loser: 1, event: 106, period: P - 6, isDq: true, minute: 5000 },
      ]);
      await run();
      expect(await board()).toEqual(before);
    });

    it("drops sets with no rating period and counts them in the summary", async () => {
      await addSets([{ winner: 8, loser: 1, event: 101, period: null }]);
      expect(await run()).toContain("1 without a week skipped");
    });

    it("combines an alias (following a chain) into the main player", async () => {
      await addPlayers([20, 21]);
      await db.update(players).set({ mergedInto: 1 }).where(eq(players.id, 20));
      await db.update(players).set({ mergedInto: 20 }).where(eq(players.id, 21));
      await addSets([
        { winner: 20, loser: 2, event: 101, period: P - 1 },
        { winner: 21, loser: 3, event: 101, period: P - 1 },
        { winner: 21, loser: 1, event: 101, period: P - 1 }, // a self-set after merging: ignored
      ]);
      await run();
      const rows = await board();
      expect(rows.map((r) => r.playerId)).not.toContain(20);
      expect(rows.map((r) => r.playerId)).not.toContain(21);
      expect(rows.find((r) => r.playerId === 1)?.setsPlayed).toBe(44);
      expect((await history()).some((h) => h.playerId === 20 || h.playerId === 21)).toBe(false);
    });

    it("ranks a player at exactly 10 sets and 3 events, but not one with 9 sets", async () => {
      await addPlayers([90, 91]);
      for (const e of [201, 202, 203]) await addEvent(e, P);
      const specs: SetSpec[] = [];
      for (const [id, count] of [
        [90, 10],
        [91, 9],
      ] as const)
        for (let i = 0; i < count; i += 1) {
          const opponent = CORE[i % 8]!;
          specs.push({
            winner: i % 2 ? id : opponent,
            loser: i % 2 ? opponent : id,
            event: 201 + (i % 3),
            period: P,
          });
        }
      await addSets(specs);
      await run();
      const rows = await board();
      const exact = rows.find((r) => r.playerId === 90);
      const nine = rows.find((r) => r.playerId === 91);
      expect(exact).toMatchObject({ eligible: true, setsPlayed: 10, eventsPlayed: 3 });
      expect(exact?.rd).toBeLessThanOrEqual(110);
      // 9 sets also leave RD just above 110, so the set rule alone is tested in @sr/ranking.
      expect(nine).toMatchObject({ eligible: false, rank: null, setsPlayed: 9, eventsPlayed: 3 });
    });

    it("counts an event attended only through a DQ toward the 3 events", async () => {
      await addPlayers([95]);
      await addEvent(400, P - 1);
      await addSets([{ winner: 1, loser: 95, event: 400, period: P - 1, isDq: true }]);
      await run();
      expect((await board()).find((r) => r.playerId === 1)?.eventsPlayed).toBe(7);
      // 95 has no rated sets, so it is not rated at all.
      expect((await board()).some((r) => r.playerId === 95)).toBe(false);
    });

    it("never shows readers an empty leaderboard during a rebuild", async () => {
      await run();
      const before = await board();
      const reader = createDb(testDatabaseUrl!, { maxConnections: 1 });
      let seenDuring: unknown[] = [];
      try {
        await addSets([{ winner: 8, loser: 1, event: 101, period: P - 1 }]);
        await run([], NOW, {
          beforeCommit: async () => {
            seenDuring = await reader.db
              .select()
              .from(leaderboard)
              .orderBy(asc(leaderboard.playerId));
          },
        });
      } finally {
        await reader.close();
      }
      expect(seenDuring).toEqual([...before].sort((a, b) => a.playerId - b.playerId));
      expect(await board()).not.toEqual(before);
    });

    /** Week-P ranks, then player 8 beats everyone in week P + 1. */
    async function rolloverSetup() {
      await run();
      const lastWeek = new Map((await board()).map((r) => [String(r.playerId), r.rank]));
      await addEvent(500, P + 1);
      await addSets(
        CORE.slice(0, 7).map((loser) => ({ winner: 8, loser, event: 500, period: P + 1 })),
      );
      return lastWeek;
    }
    async function expectConsistentSnapshot(lastWeek: Map<string, number | null>) {
      const snapshot = JSON.parse((await metaValue("previous_ranks"))!) as {
        period: number;
        ranks: Record<string, number>;
      };
      expect(snapshot).toEqual({ period: P, ranks: Object.fromEntries(lastWeek) });
      expect(await metaValue("ranks_period")).toBe(String(P + 1));
      for (const row of await board()) {
        expect(row.rankDelta7d).toBe(lastWeek.get(String(row.playerId))! - row.rank!);
      }
    }

    it("serialises overlapping runs: the second waits for the lock, and the snapshot stays week P", async () => {
      const lastWeek = await rolloverSetup();
      let second: Promise<string> | undefined;
      let sawWaiter = false;
      await run([], NOW + WEEK_MS, {
        beforeCommit: async () => {
          // Start a second run while the first still holds the lock, and wait until it blocks.
          second = run([], NOW + WEEK_MS + 60_000);
          for (let i = 0; i < 400 && !sawWaiter; i += 1) {
            const [row] = await db.execute(
              sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`,
            );
            sawWaiter = Number(row?.n) > 0;
            if (!sawWaiter) await new Promise((resolve) => setTimeout(resolve, 25));
          }
        },
      });
      await second;
      expect(sawWaiter).toBe(true);
      await expectConsistentSnapshot(lastWeek);
      expect(await metaValue("data_version")).toBe("3");
    });

    it("two concurrent runs (Promise.all) after a rollover leave a consistent snapshot", async () => {
      const lastWeek = await rolloverSetup();
      await Promise.all([run([], NOW + WEEK_MS), run([], NOW + WEEK_MS + 1000)]);
      await expectConsistentSnapshot(lastWeek);
      expect(await metaValue("data_version")).toBe("3");
    });

    it("treats a corrupt previous_ranks as no snapshot, with one warning", async () => {
      await run();
      await db.insert(meta).values({ key: "previous_ranks", value: '{"period":"x"}' });
      await db
        .update(meta)
        .set({ value: String(P) })
        .where(eq(meta.key, "ranks_period"));
      const out = await run();
      expect(out.match(/previous_ranks is unreadable/g)).toHaveLength(1);
      expect((await board()).every((r) => r.rankDelta7d === null)).toBe(true);
    });

    it("escapes pipes, backticks, and newlines in gamer tags in the top-20 table", async () => {
      await db.update(players).set({ gamerTag: "a|b`c\nd" }).where(eq(players.id, 1));
      const out = await run();
      expect(out).toContain("| 1 | a\\|b\\`c d |");
    });

    it("takes rank_delta_7d from last week's final ranks after a week rollover", async () => {
      await run();
      const lastWeek = new Map((await board()).map((r) => [r.playerId, r.rank]));
      expect((await board()).every((r) => r.rankDelta7d === null)).toBe(true);
      // Next week, player 8 beats everyone.
      await addEvent(500, P + 1);
      await addSets(
        CORE.slice(0, 7).map((loser) => ({ winner: 8, loser, event: 500, period: P + 1 })),
      );
      for (const now of [NOW + WEEK_MS, NOW + WEEK_MS + 3_600_000]) {
        await run([], now);
        const snapshot = JSON.parse((await metaValue("previous_ranks"))!) as { period: number };
        expect(snapshot.period).toBe(P);
        for (const row of await board()) {
          expect(row.rankDelta7d).toBe(lastWeek.get(row.playerId)! - row.rank!);
        }
      }
      expect((await board()).find((r) => r.playerId === 8)!.rankDelta7d).toBeGreaterThan(0);
    });

    it("sets last_active_at to the latest completed rated set", async () => {
      await addSets([{ winner: 3, loser: 1, event: 101, period: P - 1, isDq: true, minute: 9000 }]);
      await run();
      const [{ latest }] = (await db.execute(sql`
        select max(completed_at) as latest from sets
        where not is_dq and (winner_id = 3 or loser_id = 3)`)) as unknown as [{ latest: string }];
      const row = (await board()).find((r) => r.playerId === 3);
      expect(row?.lastActiveAt).toEqual(new Date(latest));
      expect(row?.lastActiveAt).toEqual(completedAt(P - 1, 3 * 10 + 8));
    });

    it("keeps only active weeks plus the current week in rating_history", async () => {
      await db
        .insert(ratingHistory)
        .values({ playerId: 1, period: P - 60, rating: 1, rd: 1, volatility: 1 });
      await run();
      let rows = await history();
      expect(rows.every((h) => h.setsPlayed > 0 || h.period === P)).toBe(true);
      expect(rows.filter((h) => h.playerId === 1).map((h) => h.period)).toEqual([
        P - 6,
        P - 5,
        P - 4,
        P - 3,
        P - 2,
        P - 1,
        P,
      ]);
      // A week later, last week's idle "as of" row is gone and the new week has one.
      await run([], NOW + WEEK_MS);
      rows = await history();
      expect(rows.filter((h) => h.playerId === 1).map((h) => h.period)).toEqual([
        P - 6,
        P - 5,
        P - 4,
        P - 3,
        P - 2,
        P - 1,
        P + 1,
      ]);
    });

    it("dry run prints the top 20 and writes nothing", async () => {
      const out = await run(["--dry-run"]);
      expect(out).toContain("[dry run] rate:");
      expect(out).toContain("| 1 | P1 |");
      expect(await board()).toEqual([]);
      expect(await db.select().from(ingestRuns)).toEqual([]);
      expect(await db.select().from(meta)).toEqual([]);
    });

    it("appends the top 20 to GITHUB_STEP_SUMMARY when it is set", async () => {
      const dir = mkdtempSync(join(tmpdir(), "sr-rate-"));
      try {
        const file = join(dir, "summary.md");
        await run([], NOW, {}, { GITHUB_STEP_SUMMARY: file });
        const summary = readFileSync(file, "utf8");
        expect(summary).toMatch(/### Top 20[\s\S]*\| 1 \| P1 \|/);
        expect(summary).toContain("_Data from start.gg_");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("rates ~2k players and 20k sets in a few seconds", async () => {
      // Synthetic seed: 2,000 players, 200 events over 52 weeks, 20,000 sets; lower ids are stronger.
      let state = 42; // mulberry32: small, deterministic PRNG
      const random = () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), state | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const ids = Array.from({ length: 2000 }, (_, i) => 1000 + i);
      await addPlayers(ids);
      for (let e = 0; e < 200; e += 1) await addEvent(10_000 + e, P - 51 + Math.floor(e / 4));
      const specs: SetSpec[] = [];
      for (let i = 0; i < 20_000; i += 1) {
        const e = Math.floor(random() * 200);
        const a = ids[Math.floor(random() * 2000)]!;
        const b = ids[(a - 1000 + 1 + Math.floor(random() * 1999)) % 2000]!;
        const aWins = random() < (a < b ? 0.75 : 0.25);
        specs.push({
          winner: aWins ? a : b,
          loser: aWins ? b : a,
          event: 10_000 + e,
          period: P - 51 + Math.floor(e / 4),
          minute: i % 5000,
        });
      }
      await addSets(specs);
      const started = performance.now();
      const out = await run();
      const seconds = (performance.now() - started) / 1000;
      console.log(`rate job on synthetic seed: ${seconds.toFixed(2)} s\n${out}`);
      expect(seconds).toBeLessThan(15);
      const counts = await db.execute(sql`select count(*)::int as n from rating_history`);
      console.log(`rating_history rows: ${JSON.stringify(counts[0])}`);
    }, 60_000);
  },
);
