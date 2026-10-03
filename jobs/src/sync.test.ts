import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { periodIndexFor } from "@sr/core";
import {
  createDb,
  events,
  ingestRuns,
  players,
  sets,
  standings,
  tournaments,
  type Database,
} from "@sr/db";
import { runMigrations } from "@sr/db/migrate";
import { runJob } from "./harness";
import { parseCursor, selectEvents, sync } from "./sync";

const TOKEN = "SECRET-TOKEN-abc123";
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const HOUR = 3_600_000;
// Four days after the event: inside the regular sync's 14 day pending lookback.
const NOW = Date.parse("2025-10-12T12:00:00Z");
const EVENT_START = new Date("2025-10-08T18:00:00Z");

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../packages/startgg/fixtures/${name}.json`, import.meta.url), "utf8"),
  );

type Reply = { status?: number; body: unknown };

describe("parseCursor", () => {
  it("reads a saved checkpoint and ignores garbage", () => {
    expect(parseCursor('{"page":2,"perPage":40}')).toEqual({ page: 2, perPage: 40 });
    expect(parseCursor("not json")).toBeUndefined();
    expect(parseCursor(null)).toBeUndefined();
  });
});

// CI must always run the database tests; a silent skip would hide a broken setup.
if (process.env.CI && !testDatabaseUrl) throw new Error("TEST_DATABASE_URL must be set in CI");

describe.skipIf(!testDatabaseUrl)(
  testDatabaseUrl
    ? "sync job"
    : "sync job (skipped: TEST_DATABASE_URL is not set; CI always sets it)",
  () => {
    let db: Database;
    let close: () => Promise<void>;
    const env = { STARTGG_TOKEN: TOKEN, DATABASE_URL: testDatabaseUrl };
    let nowMs = NOW;
    let sent: { query: string; eventId: number; page: number; perPage: number }[];
    let queues: Record<string, Reply[]>;

    /** Fake start.gg: one reply queue per "sets:<eventId>" / "standings:<eventId>". */
    const fakeFetch = async (_url: string, init: RequestInit) => {
      const { query, variables } = JSON.parse(String(init.body)) as {
        query: string;
        variables: { eventId: number; page: number; perPage: number };
      };
      const kind = query.includes("EventSetsPage") ? "sets" : "standings";
      sent.push({ query: kind, ...variables });
      const reply = queues[`${kind}:${variables.eventId}`]?.shift();
      if (!reply) throw new Error(`fake fetch: no ${kind} reply queued for ${variables.eventId}`);
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
    };
    const happy = (): Record<string, Reply[]> => ({
      "sets:9001": [{ body: fixture("sets-page-1") }, { body: fixture("sets-page-2") }],
      "standings:9001": [{ body: fixture("standings-page-1") }],
    });

    const run = (argv: string[] = [], out: string[] = []) => {
      let clientNow = 1_000_000;
      return runJob("sync", ["--skip-discover", ...argv], sync, {
        env,
        now: () => nowMs,
        clientOptions: {
          fetch: fakeFetch,
          clock: () => clientNow,
          sleep: async (ms) => void (clientNow += ms),
          logger: () => {},
        },
        out: (line) => out.push(line),
      });
    };
    const quietly = async <T>(body: () => Promise<T>) => {
      const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      try {
        const result = await body();
        return { result, text: stderr.mock.calls.join("") };
      } finally {
        stderr.mockRestore();
      }
    };

    async function seedEvent(
      id: number,
      fields: Partial<typeof events.$inferInsert> = {},
    ): Promise<void> {
      await db
        .insert(tournaments)
        .values({ id: 5000 + id, slug: `t-${id}`, name: `T ${id}` })
        .onConflictDoNothing();
      await db.insert(events).values({
        id,
        tournamentId: 5000 + id,
        slug: `e-${id}`,
        name: `E ${id}`,
        startAt: EVENT_START,
        qualifies: true,
        state: "COMPLETED",
        ...fields,
      });
    }
    const eventRow = async (id: number) =>
      (await db.select().from(events).where(eq(events.id, id)))[0];
    const setIds = async () => (await db.select().from(sets).orderBy(sets.id)).map((s) => s.id);

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
      await db.delete(standings);
      await db.delete(sets);
      await db.delete(players);
      await db.delete(events);
      await db.delete(tournaments);
      await db.delete(ingestRuns);
      nowMs = NOW;
      sent = [];
      queues = happy();
    });
    afterAll(async () => {
      await close?.();
    });

    it("syncs through to the end, marks the event done, and writes one ingest_runs row", async () => {
      await seedEvent(9001, { syncStatus: "partial", syncCursor: null });
      const out: string[] = [];
      expect(await run([], out)).toBe(0);
      expect(out).toEqual([
        "sync: 1 events, 3 sets (1 DQ), 2 standings, 0 entrants without player; 3 requests",
      ]);
      expect(await setIds()).toEqual([7001, 7002, 7003]);
      expect((await db.select().from(standings)).map((s) => [s.playerId, s.placement])).toEqual(
        expect.arrayContaining([
          [1, 1],
          [4, 2],
        ]),
      );
      expect(await eventRow(9001)).toMatchObject({
        syncStatus: "done",
        syncCursor: null,
        lastSyncedAt: new Date(NOW),
      });
      const runs = await db.select().from(ingestRuns);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        job: "sync",
        status: "success",
        requestsUsed: 3,
        eventsTouched: 1,
        error: null,
      });
      const [first] = await db.select().from(sets).where(eq(sets.id, 7001));
      expect(first?.ratingPeriod).toBe(periodIndexFor(new Date(1760000000 * 1000)));
    });

    it("stores a DQ set with is_dq = true and null games", async () => {
      await seedEvent(9001);
      await run();
      const [dq] = await db.select().from(sets).where(eq(sets.id, 7002));
      expect(dq).toMatchObject({
        isDq: true,
        winnerGames: null,
        loserGames: null,
        winnerId: 3,
        loserId: 4,
      });
      const [normal] = await db.select().from(sets).where(eq(sets.id, 7001));
      expect(normal).toMatchObject({ isDq: false, winnerGames: 3, loserGames: 1 });
    });

    it("saves a partial cursor when the time budget runs out, then resumes without duplicating", async () => {
      await seedEvent(9001);
      queues = {
        "sets:9001": [
          {
            get body() {
              nowMs += 30 * 60_000; // the budget (20 min) ends while page 1 is being fetched
              return fixture("sets-page-1");
            },
          },
        ],
      };
      const out: string[] = [];
      expect(await run([], out)).toBe(0);
      expect(out[0]).toContain("stopped early: time budget");
      expect(await eventRow(9001)).toMatchObject({
        syncStatus: "partial",
        syncCursor: '{"page":2,"perPage":40}',
        lastSyncedAt: null,
      });
      expect(await setIds()).toEqual([7001, 7002]);
      expect((await db.select().from(ingestRuns))[0]?.status).toBe("partial");

      // Next run: only page 2 is requested.
      sent = [];
      queues = {
        "sets:9001": [{ body: fixture("sets-page-2") }],
        "standings:9001": [{ body: fixture("standings-page-1") }],
      };
      expect(await run()).toBe(0);
      expect(sent.filter((r) => r.query === "sets").map((r) => r.page)).toEqual([2]);
      expect(await setIds()).toEqual([7001, 7002, 7003]);
      expect(await eventRow(9001)).toMatchObject({ syncStatus: "done", syncCursor: null });
    });

    it("resumes from a saved cursor with its page size", async () => {
      await seedEvent(9001, { syncStatus: "partial", syncCursor: '{"page":2,"perPage":20}' });
      queues["sets:9001"] = [{ body: fixture("sets-page-2") }];
      expect(await run()).toBe(0);
      expect(sent[0]).toMatchObject({ query: "sets", page: 2, perPage: 20 });
      expect(await setIds()).toEqual([7003]);
    });

    it("creates no duplicates when everything is synced again", async () => {
      await seedEvent(9001);
      await run();
      await db.update(events).set({ syncStatus: "pending" }).where(eq(events.id, 9001));
      queues = happy();
      await run();
      expect(await setIds()).toEqual([7001, 7002, 7003]);
      expect(await db.select().from(players)).toHaveLength(4);
      expect(await db.select().from(standings)).toHaveLength(2);
      expect(await db.select().from(ingestRuns)).toHaveLength(2);
    });

    it("retries after a mid-run rate-limit error", async () => {
      await seedEvent(9001);
      queues["sets:9001"] = [
        { body: fixture("error-rate-limit") },
        { body: fixture("sets-page-1") },
        { body: fixture("sets-page-2") },
      ];
      expect(await run()).toBe(0);
      expect(await setIds()).toEqual([7001, 7002, 7003]);
      expect((await db.select().from(ingestRuns))[0]?.requestsUsed).toBe(4);
    });

    it("shrinks the page size after a complexity error", async () => {
      await seedEvent(9001);
      queues["sets:9001"] = [
        { body: fixture("error-complexity") },
        { body: fixture("sets-page-1") },
        { body: fixture("sets-page-2") },
      ];
      expect(await run()).toBe(0);
      expect(sent.filter((r) => r.query === "sets").map((r) => [r.page, r.perPage])).toEqual([
        [1, 40],
        [1, 20],
        [2, 20],
      ]);
      expect(await setIds()).toEqual([7001, 7002, 7003]);
    });

    it("applies a tag update but never erases a stored prefix or slug with null", async () => {
      await seedEvent(9001);
      await run();
      const changed = fixture("sets-page-1") as {
        data: {
          event: { sets: { nodes: { slots: { entrant: { participants: unknown[] } }[] }[] } };
        };
      };
      changed.data.event.sets.nodes[0]!.slots[0]!.entrant.participants = [
        { player: { id: 1, gamerTag: "FakeAlphaRenamed", prefix: null, user: null } },
      ];
      queues = { ...happy(), "sets:9001": [{ body: changed }, { body: fixture("sets-page-2") }] };
      await db.update(events).set({ syncStatus: "pending" }).where(eq(events.id, 9001));
      await run();
      const [player] = await db.select().from(players).where(eq(players.id, 1));
      expect(player).toMatchObject({
        gamerTag: "FakeAlphaRenamed",
        prefix: "FAKE",
        userSlug: "user/fakealph",
      });
    });

    it("counts entrants without a start.gg player and skips them", async () => {
      await seedEvent(9002);
      queues = {
        "sets:9002": [{ body: fixture("sets-noplayer") }],
        "standings:9002": [{ body: fixture("standings-noplayer") }],
      };
      const out: string[] = [];
      expect(await run([], out)).toBe(0);
      expect(out[0]).toBe(
        "sync: 1 events, 1 sets (0 DQ), 2 standings, 2 entrants without player; 2 requests",
      );
      expect(await setIds()).toEqual([7101]);
    });

    it("marks a failing event as error, keeps going, and keeps its cursor", async () => {
      await seedEvent(9001, { startAt: new Date("2025-10-01T00:00:00Z") });
      await seedEvent(9002);
      queues = {
        // Upstream error text that echoes secrets must never reach the logs.
        "sets:9001": [{ body: { errors: [{ message: `boom ${TOKEN} ${testDatabaseUrl}` }] } }],
        "sets:9002": [{ body: fixture("sets-noplayer") }],
        "standings:9002": [{ body: fixture("standings-noplayer") }],
      };
      await db
        .update(events)
        .set({ syncCursor: '{"page":2,"perPage":40}' })
        .where(eq(events.id, 9001));
      const { result, text } = await quietly(() => run());
      expect(result).toBe(0);
      expect(text).toMatch(/event 9001 failed/);
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(String(testDatabaseUrl));
      expect(await eventRow(9001)).toMatchObject({
        syncStatus: "error",
        syncCursor: '{"page":2,"perPage":40}',
      });
      expect((await eventRow(9002))?.syncStatus).toBe("done");
    });

    it("gives a run error, leaks no token, and leaves events untouched on an auth failure", async () => {
      await seedEvent(9001);
      queues["sets:9001"] = [{ status: 401, body: { message: `bad ${TOKEN}` } }];
      const { result, text } = await quietly(() => run());
      expect(result).toBe(1);
      const [row] = await db.select().from(ingestRuns);
      expect(row).toMatchObject({ status: "error", requestsUsed: 1 });
      expect(row?.error).toMatch(/token/i);
      expect(`${row?.error}${text}`).not.toContain(TOKEN);
      expect(await eventRow(9001)).toMatchObject({ syncStatus: "pending" });
    });

    it("never requests a qualifies = false event, even with --event", async () => {
      await seedEvent(9003, { qualifies: false, isOnline: true });
      expect(await run()).toBe(0);
      expect(sent).toEqual([]);
      const { result, text } = await quietly(() => run(["--event", "9003"]));
      expect(result).toBe(2);
      expect(text).toMatch(/does not qualify/);
      expect(sent).toEqual([]);
      // Even a "done" non-qualifying event is not re-synced.
      await db
        .update(events)
        .set({ syncStatus: "done", lastSyncedAt: new Date(EVENT_START.getTime() + HOUR) })
        .where(eq(events.id, 9003));
      await run();
      expect(sent).toEqual([]);
    });

    it("syncs a single event with --event", async () => {
      await seedEvent(9001);
      await seedEvent(9002);
      expect(await run(["--event", "9001"])).toBe(0);
      expect(new Set(sent.map((r) => r.eventId))).toEqual(new Set([9001]));
      expect((await eventRow(9002))?.syncStatus).toBe("pending");
    });

    it("dry run fetches and prints a summary but writes nothing", async () => {
      await seedEvent(9001);
      const out: string[] = [];
      expect(await run(["--dry-run"], out)).toBe(0);
      expect(out).toEqual([
        "[dry run] sync: 1 events, 3 sets (1 DQ), 2 standings, 0 entrants without player; 3 requests",
      ]);
      expect(await db.select().from(sets)).toHaveLength(0);
      expect(await db.select().from(players)).toHaveLength(0);
      expect(await db.select().from(ingestRuns)).toHaveLength(0);
      expect(await eventRow(9001)).toMatchObject({ syncStatus: "pending", lastSyncedAt: null });
    });

    it("picks the right events: past, qualifying, due, in priority order, capped", async () => {
      const day = 24 * HOUR;
      const ago = (days: number) => new Date(NOW - days * day);
      await seedEvent(1, { startAt: ago(3), syncStatus: "pending" });
      await seedEvent(2, { startAt: new Date(NOW + day), syncStatus: "pending" }); // future
      await seedEvent(3, { startAt: ago(9), qualifies: false }); // online metadata only
      await seedEvent(4, {
        startAt: ago(10),
        syncStatus: "done",
        lastSyncedAt: new Date(ago(10).getTime() + HOUR), // synced within 48 h of start; now > start + 72 h
      });
      await seedEvent(5, {
        startAt: ago(10),
        syncStatus: "done",
        lastSyncedAt: new Date(ago(10).getTime() + 60 * HOUR), // already past 48 h: no re-check
      });
      await seedEvent(6, {
        startAt: ago(2),
        syncStatus: "done",
        lastSyncedAt: new Date(ago(2).getTime() + HOUR), // not yet 72 h after start
      });
      await seedEvent(7, { startAt: ago(6), syncStatus: "error", lastSyncedAt: ago(0.5) }); // waits 24 h
      await seedEvent(8, { startAt: ago(5), syncStatus: "partial" });
      await seedEvent(9, { startAt: null, syncStatus: "pending" }); // no start date
      await seedEvent(10, { startAt: ago(7), syncStatus: "error", lastSyncedAt: ago(0.9) });
      await seedEvent(11, { startAt: ago(8), syncStatus: "error", lastSyncedAt: null });
      const picked = await selectEvents(db, new Date(NOW));
      // pending/partial (oldest start first), then the due re-check, then the retryable error.
      expect(picked.map((e) => e.id)).toEqual([8, 1, 4, 11]);
      expect((await selectEvents(db, new Date(NOW), 2)).map((e) => e.id)).toEqual([8, 1]);
    });

    it("fires the 48 h re-check exactly once", async () => {
      const start = new Date(NOW - 10 * 24 * HOUR);
      await seedEvent(9001, {
        startAt: start,
        syncStatus: "done",
        lastSyncedAt: new Date(start.getTime() + 5 * HOUR),
      });
      expect((await selectEvents(db, new Date(NOW))).map((e) => e.id)).toEqual([9001]);
      expect(await run()).toBe(0);
      expect(await eventRow(9001)).toMatchObject({
        syncStatus: "done",
        lastSyncedAt: new Date(NOW),
      });
      for (const later of [0, 1, 30, 400]) {
        expect(await selectEvents(db, new Date(NOW + later * 24 * HOUR))).toEqual([]);
      }
    });

    it("keeps failing events from starving fresh ones", async () => {
      for (let id = 1; id <= 30; id++) {
        await seedEvent(id, {
          startAt: new Date(NOW - 20 * 24 * HOUR),
          syncStatus: "error",
          lastSyncedAt: new Date(NOW - 25 * HOUR),
        });
      }
      await seedEvent(100, { startAt: new Date(NOW - 24 * HOUR), syncStatus: "pending" });
      await seedEvent(101, { startAt: new Date(NOW - 23 * HOUR), syncStatus: "pending" });
      const picked = (await selectEvents(db, new Date(NOW))).map((e) => e.id);
      expect(picked).toHaveLength(25);
      expect(picked.slice(0, 2)).toEqual([100, 101]);
    });

    it("records the attempt time on error and waits 24 h before retrying", async () => {
      await seedEvent(9001);
      queues["sets:9001"] = [{ body: { errors: [{ message: "boom" }] } }];
      await quietly(() => run());
      expect(await eventRow(9001)).toMatchObject({
        syncStatus: "error",
        lastSyncedAt: new Date(NOW),
      });
      expect(await selectEvents(db, new Date(NOW + 23 * HOUR))).toEqual([]);
      expect((await selectEvents(db, new Date(NOW + 25 * HOUR))).map((e) => e.id)).toEqual([9001]);
    });

    it("stores one standings row per player when two entrants share a player", async () => {
      await seedEvent(9001);
      queues["standings:9001"] = [{ body: fixture("standings-duplicate-player") }];
      expect(await run()).toBe(0);
      expect(await eventRow(9001)).toMatchObject({ syncStatus: "done" });
      expect(
        (await db.select().from(standings).orderBy(standings.playerId)).map((s) => [
          s.playerId,
          s.placement,
        ]),
      ).toEqual([
        [1, 1],
        [4, 2],
      ]);
    });

    it("removes sets and standings that disappeared upstream on a full re-sync", async () => {
      await seedEvent(9001);
      await run();
      expect(await setIds()).toEqual([7001, 7002, 7003]);
      const gone = fixture("sets-page-2") as { data: { event: { sets: { nodes: unknown[] } } } };
      gone.data.event.sets.nodes = []; // set 7003 is no longer completed
      (gone.data.event.sets as unknown as { pageInfo: { total: number } }).pageInfo.total = 2;
      const fewer = fixture("standings-page-1") as {
        data: { event: { standings: { nodes: unknown[] } } };
      };
      fewer.data.event.standings.nodes = fewer.data.event.standings.nodes.slice(0, 1);
      (fewer.data.event.standings as unknown as { pageInfo: { total: number } }).pageInfo.total = 1;
      queues = {
        "sets:9001": [{ body: fixture("sets-page-1") }, { body: gone }],
        "standings:9001": [{ body: fewer }],
      };
      await db.update(events).set({ syncStatus: "pending" }).where(eq(events.id, 9001));
      await run();
      expect(await setIds()).toEqual([7001, 7002]);
      expect((await db.select().from(standings)).map((s) => s.playerId)).toEqual([1]);
    });

    it("does not delete anything when the pass resumed from a cursor", async () => {
      await seedEvent(9001, { syncStatus: "partial", syncCursor: '{"page":2,"perPage":40}' });
      await db.insert(players).values([
        { id: 1, gamerTag: "A" },
        { id: 2, gamerTag: "B" },
      ]);
      await db.insert(sets).values({ id: 7001, eventId: 9001, winnerId: 1, loserId: 2 });
      queues["sets:9001"] = [{ body: fixture("sets-page-2") }];
      expect(await run()).toBe(0);
      expect(await setIds()).toEqual([7001, 7003]);
      expect(await eventRow(9001)).toMatchObject({ syncStatus: "done", syncCursor: null });
    });

    it("syncs a live event from page 1 every run, drops its cursor, and never marks it done", async () => {
      await seedEvent(9001, {
        state: "ACTIVE",
        startAt: new Date(NOW - 2 * 24 * HOUR),
        syncStatus: "partial",
        syncCursor: '{"page":2,"perPage":40}',
      });
      expect(await run()).toBe(0);
      expect(sent.filter((r) => r.query === "sets").map((r) => r.page)).toEqual([1, 2]);
      expect(await eventRow(9001)).toMatchObject({
        syncStatus: "partial",
        syncCursor: null,
        lastSyncedAt: new Date(NOW),
      });
      // Picked again next run, still from page 1.
      queues = happy();
      sent = [];
      nowMs = NOW + 2 * HOUR;
      expect(await run()).toBe(0);
      expect(sent.filter((r) => r.query === "sets").map((r) => r.page)).toEqual([1, 2]);
      expect((await eventRow(9001))?.syncStatus).toBe("partial");
      // Once COMPLETED, one full pass marks it done.
      await db.update(events).set({ state: "COMPLETED" }).where(eq(events.id, 9001));
      queues = happy();
      expect(await run()).toBe(0);
      expect(await eventRow(9001)).toMatchObject({ syncStatus: "done", syncCursor: null });
    });

    it("treats an unclosed event older than 7 days as finished and marks it done", async () => {
      await seedEvent(9001, { state: "ACTIVE", startAt: new Date(NOW - 8 * 24 * HOUR) });
      expect(await run()).toBe(0);
      expect(await eventRow(9001)).toMatchObject({ syncStatus: "done", syncCursor: null });
    });

    it("deletes nothing when the page total is missing or larger than what was seen", async () => {
      await seedEvent(9001);
      await run();
      const short = fixture("sets-page-1") as {
        data: { event: { sets: { pageInfo: { totalPages: number | null; total: number } } } };
      };
      short.data.event.sets.pageInfo.totalPages = null; // start.gg did not say; page 1 looks like the end
      queues = {
        "sets:9001": [{ body: short }],
        "standings:9001": [{ body: fixture("standings-page-1") }],
      };
      await db.update(events).set({ syncStatus: "pending" }).where(eq(events.id, 9001));
      await run();
      expect(await setIds()).toEqual([7001, 7002, 7003]); // 7003 kept: saw 2 of total 3
      expect(await eventRow(9001)).toMatchObject({ syncStatus: "done" });
    });

    it("re-checks a done event from page 1 without a cursor, and keeps it eligible if interrupted", async () => {
      const start = new Date(NOW - 10 * 24 * HOUR);
      await seedEvent(9001, {
        startAt: start,
        syncStatus: "done",
        syncCursor: '{"page":2,"perPage":40}',
        lastSyncedAt: new Date(start.getTime() + HOUR),
      });
      queues = {
        "sets:9001": [
          {
            get body() {
              nowMs += 30 * 60_000; // budget ends during page 1
              return fixture("sets-page-1");
            },
          },
        ],
      };
      expect(await run()).toBe(0);
      expect(sent.filter((r) => r.query === "sets").map((r) => r.page)).toEqual([1]);
      expect(await eventRow(9001)).toMatchObject({ syncStatus: "partial", syncCursor: null });
      expect((await selectEvents(db, new Date(NOW))).map((e) => e.id)).toEqual([9001]);
    });

    it("a dry run leaves every table unchanged", async () => {
      await seedEvent(9001);
      const counts = async () =>
        [events, sets, players, standings, ingestRuns].map(
          async (table) => (await db.select().from(table)).length,
        );
      const before = await Promise.all(await counts());
      expect(await run(["--dry-run"])).toBe(0);
      expect(await Promise.all(await counts())).toEqual(before);
      expect(await eventRow(9001)).toMatchObject({ syncStatus: "pending", syncCursor: null });
    });
  },
);
