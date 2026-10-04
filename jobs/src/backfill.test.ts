import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDb,
  events,
  ingestRuns,
  meta,
  players,
  sets,
  standings,
  tournaments,
  type Database,
} from "@sr/db";
import { runMigrations } from "@sr/db/migrate";
import {
  backfill,
  BACKFILL_CURSOR_KEY,
  BACKFILL_DISCOVER_CURSOR_KEY,
  monthsToCover,
} from "./backfill";
import {
  BACKFILL_DISCOVER_PER_DAY,
  DISCOVER_DAY_KEY,
  DISCOVER_SPENT_KEYS,
  SYNC_DISCOVER_PER_DAY,
} from "./discover-budget";
import { parseJobArgs, runJob, UsageError } from "./harness";
import { databaseSizeLine } from "./rate";
import {
  DISCOVER_MAX_DAYS_BACK,
  DISCOVER_OVERLAP_MS,
  SYNC_DISCOVER_CURSOR_KEY,
  discoverPassStart,
  selectEvents,
  sync,
} from "./sync";

const TOKEN = "SECRET-TOKEN-abc123";
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
// Fixture events start 2025-10-09, so "now" is early November 2025: windows are Nov, then Oct.
const NOW = Date.parse("2025-11-03T00:30:00Z");
const NOON = Date.parse("2025-11-03T13:00:00Z");

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../packages/startgg/fixtures/${name}.json`, import.meta.url), "utf8"),
  );

describe("monthsToCover", () => {
  it("lists this month back to N months ago, minus finished months", () => {
    const now = new Date("2025-11-03T12:00:00Z");
    const all = monthsToCover(now, 2, null);
    expect(all.windows.map((w) => w.from.toISOString().slice(0, 10))).toEqual([
      "2025-11-01",
      "2025-10-01",
      "2025-09-01",
    ]);
    expect(all.oldest.toISOString().slice(0, 10)).toBe("2025-09-01");
    expect(monthsToCover(now, 2, new Date("2025-10-01T00:00:00Z")).windows).toHaveLength(1);
  });
});

describe("discoverPassStart", () => {
  const now = Date.parse("2025-11-20T12:00:00Z");
  const day = 86_400_000;
  it("uses the usual 3 days back when there was no earlier pass or it was recent", () => {
    expect(discoverPassStart(now, null).getTime()).toBe(now - 3 * day);
    expect(discoverPassStart(now, now - 1 * day).getTime()).toBe(now - 3 * day);
  });
  it("starts before the previous pass's start after a long gap (outage)", () => {
    const last = now - 10 * day;
    expect(discoverPassStart(now, last).getTime()).toBe(last - DISCOVER_OVERLAP_MS);
  });
  it("never looks back more than 14 days", () => {
    expect(discoverPassStart(now, now - 20 * day).getTime()).toBe(
      now - DISCOVER_MAX_DAYS_BACK * day,
    );
  });
});

describe("--months validation", () => {
  it.each(["0", "25", "1.5", "abc"])("rejects %s", (value) => {
    expect(() => parseJobArgs(["--months", value])).toThrow(UsageError);
  });
  it("accepts 1 and 24", () => {
    expect(parseJobArgs(["--months", "24"]).months).toBe(24);
  });
});

if (process.env.CI && !testDatabaseUrl) throw new Error("TEST_DATABASE_URL must be set in CI");

describe.skipIf(!testDatabaseUrl)(
  "backfill job and discover-in-sync (skipped: TEST_DATABASE_URL is not set; CI always sets it)",
  () => {
    let db: Database;
    let close: () => Promise<void>;
    const env = { STARTGG_TOKEN: TOKEN, DATABASE_URL: testDatabaseUrl };
    let nowMs = NOW;
    let sent: string[];
    let setsEventIds: number[];
    let tournamentPages: number[];
    let failTournaments: number | null;
    let failTournamentsPage: number | null;
    let bigWindow: boolean;
    let tournamentsBody: unknown;
    let failEvents: Set<number>;
    let afterFirstTournamentsReply: (() => void) | null;

    /** Fake start.gg, routed by query name; the same fixtures answer every event. */
    const fakeFetch = async (_url: string, init: RequestInit) => {
      const { query, variables } = JSON.parse(String(init.body)) as {
        query: string;
        variables: { eventId: number; page: number };
      };
      let body: unknown;
      if (query.includes("TournamentsPage")) {
        sent.push("tournaments");
        tournamentPages.push(variables.page);
        if (failTournaments) {
          return new Response(JSON.stringify({ errors: [{ message: "boom" }] }), {
            status: failTournaments,
          });
        }
        if (failTournamentsPage === variables.page) {
          return new Response(JSON.stringify({ errors: [{ message: "boom" }] }), { status: 400 });
        }
        body =
          tournamentsBody ??
          fixture(variables.page === 1 ? "tournaments-page-1" : "tournaments-page-2");
        if (bigWindow) {
          // A window with far more pages than any day's cap.
          const copy = JSON.parse(JSON.stringify(fixture("tournaments-page-2"))) as {
            data: { tournaments: { pageInfo: { totalPages: number } } };
          };
          copy.data.tournaments.pageInfo.totalPages = BACKFILL_DISCOVER_PER_DAY + 100;
          body = copy;
        }
        afterFirstTournamentsReply?.();
        afterFirstTournamentsReply = null;
      } else if (query.includes("EventSetsPage")) {
        sent.push("sets");
        if (failEvents.has(variables.eventId)) {
          return new Response(JSON.stringify({ errors: [{ message: "boom" }] }), { status: 400 });
        }
        setsEventIds.push(variables.eventId);
        body = fixture(variables.page === 1 ? "sets-page-1" : "sets-page-2");
      } else {
        sent.push("standings");
        body = fixture("standings-page-1");
      }
      return new Response(JSON.stringify(body), { status: 200 });
    };

    const run = (job: "backfill" | "sync", argv: string[], out: string[] = []) => {
      let clientNow = 1_000_000;
      return runJob(job, argv, job === "backfill" ? backfill : sync, {
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
    const cursor = async () =>
      (await db.select().from(meta).where(eq(meta.key, BACKFILL_CURSOR_KEY)))[0]?.value;
    const runs = () => db.select().from(ingestRuns).orderBy(ingestRuns.id);
    const eventStatuses = async () =>
      (await db.select().from(events).orderBy(events.id)).map((e) => [e.id, e.syncStatus]);

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
      await db.delete(meta);
      nowMs = NOW;
      sent = [];
      setsEventIds = [];
      afterFirstTournamentsReply = null;
      tournamentPages = [];
      failTournaments = null;
      failTournamentsPage = null;
      bigWindow = false;
      tournamentsBody = undefined;
      failEvents = new Set();
    });
    afterAll(async () => {
      await close?.();
    });

    it("covers each month, checkpoints the oldest, and a finished backfill is a fast no-op", async () => {
      const out: string[] = [];
      expect(await run("backfill", ["--months", "1"], out)).toBe(0);
      expect(await cursor()).toBe("2025-10-01T00:00:00.000Z");
      // 9002 is doubles: never stored.
      expect(await eventStatuses()).toEqual([
        [9001, "done"],
        [9003, "done"],
      ]);
      const [row] = await runs();
      expect(row).toMatchObject({ job: "backfill", status: "success", requestsUsed: 10 });

      sent = [];
      const again: string[] = [];
      expect(await run("backfill", ["--months", "1"], again)).toBe(0);
      expect(sent).toEqual([]);
      expect(again.join("\n")).toContain("already done");
      expect(await runs()).toHaveLength(2);
    });

    it("resumes from the checkpoint instead of starting over", async () => {
      await db.insert(meta).values({ key: BACKFILL_CURSOR_KEY, value: "2025-11-01T00:00:00.000Z" });
      expect(await run("backfill", ["--months", "1"])).toBe(0);
      expect(sent.filter((s) => s === "tournaments")).toHaveLength(2); // October only
      expect(await cursor()).toBe("2025-10-01T00:00:00.000Z");
    });

    it("stops at the time budget as partial, then the next run finishes", async () => {
      afterFirstTournamentsReply = () => void (nowMs += 2 * 3_600_000);
      expect(await run("backfill", ["--months", "1", "--time-budget-minutes", "75"])).toBe(0);
      expect((await runs())[0]).toMatchObject({ status: "partial", requestsUsed: 1 });
      expect(await cursor()).toBeUndefined();
      nowMs = NOW;
      expect(await run("backfill", ["--months", "1"])).toBe(0);
      expect((await runs())[1]?.status).toBe("success");
      expect(await cursor()).toBe("2025-10-01T00:00:00.000Z");
    });

    it("never syncs online events", async () => {
      await db.insert(tournaments).values({ id: 5100, slug: "t-online", name: "Online" });
      await db.insert(events).values({
        id: 9100,
        tournamentId: 5100,
        slug: "e-online",
        name: "Online singles",
        startAt: new Date("2025-10-10T18:00:00Z"),
        isOnline: true,
        qualifies: false,
        state: "COMPLETED",
      });
      await run("backfill", ["--months", "1"]);
      expect(setsEventIds).not.toContain(9100);
      expect(new Set(setsEventIds)).toEqual(new Set([9001, 9003]));
      expect((await eventStatuses()).find(([id]) => id === 9100)?.[1]).toBe("pending");
    });

    it("reports the database size for the rate summary", async () => {
      expect(await databaseSizeLine(db)).toMatch(
        /^Database size: [\d.]+ MB \(\d+% of the 1 GB free limit\)$/,
      );
    });

    const spendToday = async (syncSpent: number, backfillSpent: number) => {
      await db.delete(meta);
      await db.insert(meta).values([
        { key: DISCOVER_DAY_KEY, value: "2025-11-03" },
        { key: DISCOVER_SPENT_KEYS.sync, value: String(syncSpent) },
        { key: DISCOVER_SPENT_KEYS.backfill, value: String(backfillSpent) },
      ]);
    };
    const spent = async () => ({
      sync: Number(await metaValue(DISCOVER_SPENT_KEYS.sync)),
      backfill: Number(await metaValue(DISCOVER_SPENT_KEYS.backfill)),
    });
    const metaValue = async (key: string) =>
      (await db.select().from(meta).where(eq(meta.key, key)))[0]?.value;

    it("backfill's daily cap stops its discover mid-month, and the next run resumes at the saved page", async () => {
      await spendToday(0, BACKFILL_DISCOVER_PER_DAY - 1);
      await run("backfill", ["--months", "1"]);
      expect(tournamentPages).toEqual([1]);
      expect((await runs())[0]).toMatchObject({ status: "partial", requestsUsed: 1 });
      expect((await spent()).backfill).toBe(BACKFILL_DISCOVER_PER_DAY);
      expect(JSON.parse((await metaValue(BACKFILL_DISCOVER_CURSOR_KEY)) ?? "null")).toMatchObject({
        from: "2025-11-01T00:00:00.000Z",
        cursor: { page: 2 },
      });
      expect(await cursor()).toBeUndefined();

      // Same day: the budget is gone, so nothing is requested.
      tournamentPages = [];
      await run("backfill", ["--months", "1"]);
      expect(tournamentPages).toEqual([]);

      nowMs = NOW + 24 * 3_600_000; // next UTC day
      await run("backfill", ["--months", "1"]);
      expect(tournamentPages[0]).toBe(2);
      expect(await cursor()).toBe("2025-10-01T00:00:00.000Z");
      expect(await metaValue(BACKFILL_DISCOVER_CURSOR_KEY)).toBeUndefined();
    });

    it("the daily discover in sync draws from the remaining budget and continues the next day", async () => {
      await spendToday(SYNC_DISCOVER_PER_DAY - 1, 0);
      await run("sync", []);
      expect(tournamentPages).toEqual([1]);
      expect((await runs()).find((r) => r.job === "discover")).toMatchObject({ status: "partial" });
      expect(await metaValue(SYNC_DISCOVER_CURSOR_KEY)).toContain('"page":2');

      tournamentPages = [];
      await run("sync", []); // same day: budget used up
      expect(tournamentPages).toEqual([]);

      nowMs = NOW + 24 * 3_600_000;
      await run("sync", []);
      expect(tournamentPages).toEqual([2]);
      expect((await runs()).filter((r) => r.job === "discover").at(-1)?.status).toBe("success");
      expect(await metaValue(SYNC_DISCOVER_CURSOR_KEY)).toBeUndefined();
    });

    it("one failing month of events does not fail the backfill, and the checkpoint moves", async () => {
      failEvents = new Set([9001, 9003]);
      expect(await run("backfill", ["--months", "1"])).toBe(0);
      expect((await runs())[0]?.status).toBe("success");
      expect(await cursor()).toBe("2025-10-01T00:00:00.000Z");
      expect(await eventStatuses()).toEqual([
        [9001, "error"],
        [9003, "error"],
      ]);
    });

    it("the regular sync serves a fresh live event ahead of 30 old pending ones", async () => {
      await db.insert(tournaments).values({ id: 1, slug: "t", name: "T" });
      const base = { tournamentId: 1, qualifies: true, state: "COMPLETED" };
      await db.insert(events).values([
        ...Array.from({ length: 30 }, (_, i) => ({
          ...base,
          id: 100 + i,
          slug: `old-${i}`,
          name: `Old ${i}`,
          startAt: new Date(NOW - 60 * 86_400_000),
        })),
        {
          ...base,
          id: 200,
          slug: "fresh",
          name: "Fresh",
          state: "ACTIVE",
          startAt: new Date(NOW - 86_400_000),
        },
      ]);
      const picked = (await selectEvents(db, new Date(NOW))).map((c) => c.id);
      expect(picked).toHaveLength(25);
      expect(picked[0]).toBe(200); // fresh first; old pending leftovers only fill the rest
      const window = { from: new Date(NOW - 90 * 86_400_000), to: new Date(NOW) };
      expect(await selectEvents(db, new Date(NOW), 100, { window })).toHaveLength(31);
    });

    it("old pending events are synced last, but are not stranded", async () => {
      await db.insert(tournaments).values({ id: 1, slug: "t", name: "T" });
      const base = { tournamentId: 1, qualifies: true, state: "COMPLETED" };
      await db.insert(events).values([
        { ...base, id: 300, slug: "old", name: "Old", startAt: new Date(NOW - 20 * 86_400_000) },
        { ...base, id: 301, slug: "new", name: "New", startAt: new Date(NOW - 86_400_000) },
      ]);
      expect((await selectEvents(db, new Date(NOW))).map((c) => c.id)).toEqual([301, 300]);
      await run("sync", ["--skip-discover"]);
      expect(await eventStatuses()).toEqual([
        [300, "done"],
        [301, "done"],
      ]);
    });

    it("each job stops at its own daily cap", async () => {
      bigWindow = true;
      await run("sync", []);
      expect(tournamentPages).toHaveLength(SYNC_DISCOVER_PER_DAY);
      tournamentPages = [];
      await run("backfill", ["--months", "1"]);
      expect(tournamentPages).toHaveLength(BACKFILL_DISCOVER_PER_DAY);
      expect(await spent()).toEqual({
        sync: SYNC_DISCOVER_PER_DAY,
        backfill: BACKFILL_DISCOVER_PER_DAY,
      });
    });

    it("a late backfill is never starved: sync using its whole cap leaves backfill's untouched, at any hour", async () => {
      // Issue #35: the 07:41 backfill started at 13:27, after the hourly syncs had used the day.
      bigWindow = true;
      nowMs = NOON;
      await spendToday(SYNC_DISCOVER_PER_DAY, 0);
      await run("backfill", ["--months", "1"]);
      expect(tournamentPages).toHaveLength(BACKFILL_DISCOVER_PER_DAY);
    });

    it("sync never uses backfill's cap, even when backfill has spent none of it", async () => {
      bigWindow = true;
      nowMs = NOON;
      await spendToday(SYNC_DISCOVER_PER_DAY - 5, 0);
      await run("sync", []);
      expect(tournamentPages).toHaveLength(5);
      tournamentPages = [];
      await spendToday(0, BACKFILL_DISCOVER_PER_DAY);
      await run("sync", []);
      expect(tournamentPages).toHaveLength(SYNC_DISCOVER_PER_DAY);
    });

    it("discover throwing on page 2 keeps the spend and resumes at page 2 next run", async () => {
      failTournamentsPage = 2;
      expect(await run("backfill", ["--months", "1"])).toBe(1);
      expect(tournamentPages).toEqual([1, 2]);
      expect((await spent()).backfill).toBe(2);
      expect(JSON.parse((await metaValue(BACKFILL_DISCOVER_CURSOR_KEY)) ?? "null")).toMatchObject({
        cursor: { page: 2 },
      });
      failTournamentsPage = null;
      tournamentPages = [];
      expect(await run("backfill", ["--months", "1"])).toBe(0);
      expect(tournamentPages[0]).toBe(2);
      expect((await spent()).backfill).toBe(2 + tournamentPages.length);
    });

    const savedFrom = async () =>
      Date.parse(
        (JSON.parse((await metaValue(SYNC_DISCOVER_CURSOR_KEY)) ?? "null") as { from: string })
          .from,
      );

    it("every new daily discover window starts before the previous pass began, so no start time falls in a gap", async () => {
      let previousStart: number | null = null;
      for (let pass = 0; pass < 4; pass++) {
        // 80 h apart (longer than the 3-day lookback), so the overlap with the previous pass decides.
        nowMs = NOW + pass * 80 * 3_600_000;
        const passStart = nowMs;
        failTournamentsPage = 2; // page 1 saves the window, then the pass is cut short
        await run("sync", []);
        const from = await savedFrom();
        expect(from).toBeLessThanOrEqual(passStart - 3 * 86_400_000);
        if (previousStart !== null) {
          expect(from).toBeLessThanOrEqual(previousStart - DISCOVER_OVERLAP_MS);
        }
        failTournamentsPage = null;
        nowMs += 3_600_000; // the pass resumes an hour later and keeps its window
        await run("sync", []);
        expect(await metaValue(SYNC_DISCOVER_CURSOR_KEY)).toBeUndefined();
        previousStart = passStart;
      }
    });

    it("after a 10 day outage the new window reaches 10 days back, and after 20 days it stops at 14", async () => {
      const day = 86_400_000;
      for (const [daysAgo, expectedBack] of [
        [10, 10],
        [20, 14],
      ] as const) {
        await db.delete(meta);
        await db.delete(ingestRuns);
        await db.insert(meta).values({
          key: "sync_discover_last_start",
          value: new Date(NOW - daysAgo * day).toISOString(),
        });
        failTournamentsPage = 2;
        await run("sync", []);
        const back = (NOW - (await savedFrom())) / day;
        expect(back).toBeGreaterThanOrEqual(expectedBack);
        expect(back).toBeLessThanOrEqual(expectedBack + 0.25);
      }
    });

    it("a corrupt saved sync discover cursor is ignored, deleted and warned about", async () => {
      await db.insert(meta).values({ key: SYNC_DISCOVER_CURSOR_KEY, value: "{not json" });
      const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        await run("sync", []);
        expect(write.mock.calls.join("")).toContain(SYNC_DISCOVER_CURSOR_KEY);
      } finally {
        write.mockRestore();
      }
      expect(tournamentPages[0]).toBe(1);
      expect(await metaValue(SYNC_DISCOVER_CURSOR_KEY)).toBeUndefined();
    });

    it("a corrupt saved backfill cursor is ignored, deleted and warned about", async () => {
      await db.insert(meta).values({ key: BACKFILL_DISCOVER_CURSOR_KEY, value: "oops" });
      const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        expect(await run("backfill", ["--months", "1"])).toBe(0);
        expect(write.mock.calls.join("")).toContain(BACKFILL_DISCOVER_CURSOR_KEY);
      } finally {
        write.mockRestore();
      }
      expect(tournamentPages[0]).toBe(1);
      expect(await cursor()).toBe("2025-10-01T00:00:00.000Z");
    });

    it("sync discover that throws mid-window resumes at the failed page", async () => {
      failTournamentsPage = 2;
      await run("sync", []);
      expect(await metaValue(SYNC_DISCOVER_CURSOR_KEY)).toContain('"page":2');
      expect((await spent()).sync).toBe(2);
    });

    it("month M's backfill syncs an event that starts in M+1, even though M+1 is finished", async () => {
      await db.insert(meta).values({ key: BACKFILL_CURSOR_KEY, value: "2025-10-01T00:00:00.000Z" });
      const seconds = (iso: string) => Date.parse(iso) / 1000;
      tournamentsBody = {
        data: {
          tournaments: {
            pageInfo: { total: 1, totalPages: 1 },
            nodes: [
              {
                id: 5200,
                name: "Border Major",
                slug: "tournament/border",
                countryCode: "US",
                addrState: "TX", // in the launch region (ADR-0003); this test is about month boundaries
                city: "Austin",
                isOnline: false,
                numAttendees: 300,
                startAt: seconds("2025-09-30T20:00:00Z"),
                endAt: seconds("2025-10-03T20:00:00Z"),
                events: [
                  {
                    id: 9200,
                    name: "Ultimate Singles",
                    slug: "tournament/border/event/singles",
                    numEntrants: 100,
                    isOnline: false,
                    state: "COMPLETED",
                    startAt: seconds("2025-10-03T18:00:00Z"),
                    type: 1,
                    teamRosterSize: null,
                    videogame: { id: 1386 },
                  },
                ],
              },
            ],
          },
        },
      };
      expect(await run("backfill", ["--months", "2"])).toBe(0);
      expect(setsEventIds).toContain(9200);
      expect(await eventStatuses()).toEqual([[9200, "done"]]);
    });

    it("sync still syncs known events when discover fails, and records the discover error", async () => {
      await db.insert(tournaments).values({ id: 1, slug: "t", name: "T" });
      await db.insert(events).values({
        id: 9001,
        tournamentId: 1,
        slug: "e",
        name: "E",
        startAt: new Date("2025-10-30T18:00:00Z"),
        qualifies: true,
        state: "COMPLETED",
      });
      failTournaments = 400;
      expect(await run("sync", [])).toBe(0);
      expect(await eventStatuses()).toEqual([[9001, "done"]]);
      const discoverRow = (await runs()).find((r) => r.job === "discover");
      expect(discoverRow?.status).toBe("error");
      expect(discoverRow?.error).toContain("boom");
    });

    it("an auth error from discover fails the sync run", async () => {
      failTournaments = 401;
      expect(await run("sync", [])).toBe(1);
      expect((await runs()).map((r) => [r.job, r.status])).toEqual([
        ["sync", "error"],
        ["discover", "error"],
      ]);
    });

    it("a dry run prints the plan and writes nothing", async () => {
      const out: string[] = [];
      expect(await run("backfill", ["--months", "1", "--dry-run"], out)).toBe(0);
      expect(sent).toEqual([]);
      expect(out.join("\n")).toMatch(
        /plan: 2 month\(s\)[\s\S]*would cover 2 month\(s\).*requests.*about 1 run\(s\)/,
      );
      expect(await runs()).toHaveLength(0);
      expect(await db.select().from(meta)).toHaveLength(0);
      expect(await db.select().from(events)).toHaveLength(0);
    });

    it("sync runs discover first when none succeeded in 24 h, and records its own row", async () => {
      expect(await run("sync", [])).toBe(0);
      expect(sent.slice(0, 2)).toEqual(["tournaments", "tournaments"]);
      const rows = await runs();
      expect(rows.map((r) => [r.job, r.status])).toEqual([
        ["sync", "success"],
        ["discover", "success"],
      ]);
      expect(rows[1]?.requestsUsed).toBe(2);
      // Old pending events are served last by the regular sync, but not stranded.
      expect(await eventStatuses()).toEqual([
        [9001, "done"],
        [9003, "done"],
      ]);
    });

    it("sync skips discover after a recent success, with --skip-discover, and in a dry run", async () => {
      await db.insert(ingestRuns).values({
        job: "discover",
        status: "success",
        finishedAt: new Date(NOW - 23 * 3_600_000),
      });
      await run("sync", []);
      await db.delete(ingestRuns);
      await run("sync", ["--skip-discover"]);
      await run("sync", ["--dry-run"]);
      expect(sent).toEqual([]);

      // 25 hours ago is stale: discover runs again.
      await db.insert(ingestRuns).values({
        job: "discover",
        status: "success",
        finishedAt: new Date(NOW - 25 * 3_600_000),
      });
      await run("sync", []);
      expect(sent).toContain("tournaments");
    });
  },
);
