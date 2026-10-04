import {
  ATTRIBUTION,
  dashboardResponseSchema,
  errorResponseSchema,
  leaderboardResponseSchema,
  metaResponseSchema,
  playerResponseSchema,
  searchResponseSchema,
  statusResponseSchema,
} from "@sr/core";
import { createDb, type Database } from "@sr/db";
import { runMigrations } from "@sr/db/migrate";
import { SYNTHETIC_ID_MIN, seedSynthetic } from "@sr/db/seed";
import { events, meta, players, ratingHistory, sets, standings, tournaments } from "@sr/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CACHE_CONTROL_NO_STORE, CACHE_CONTROL_PUBLIC, createApp } from "./app";
import { createApiClient } from "./client";
import { periodIndexFor } from "@sr/core";

// A throwaway Postgres server. This suite uses its own sibling database
// (`<name>_api`) because @sr/db's tests drop the main one's schema in parallel.
// That sibling database is created on first run and deliberately left behind
// (its schema is rebuilt each run); it disappears with the throwaway server.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// CI must always run this suite; a silent skip would hide a broken database setup.
if (process.env.CI && !testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL must be set in CI");
}

const APP_ORIGIN = "https://app.example.test";
const PREVIEW_PATTERN = /^https:\/\/sr-app-[a-z0-9-]+\.example\.test$/;
const NOW = new Date("2026-10-03T12:00:00Z");

describe.skipIf(!testDatabaseUrl)(
  "API against a seeded database (skipped: TEST_DATABASE_URL is not set; CI always sets it)",
  () => {
    let db: Database;
    let close: (() => Promise<void>) | undefined;
    let app: ReturnType<typeof createApp>;

    beforeAll(async () => {
      if (!testDatabaseUrl) return;
      if (/neon\.tech/i.test(testDatabaseUrl)) {
        throw new Error("TEST_DATABASE_URL must be a disposable database, not Neon.");
      }
      const apiUrl = new URL(testDatabaseUrl);
      const apiDatabase = `${apiUrl.pathname.slice(1)}_api`;
      apiUrl.pathname = `/${apiDatabase}`;

      const admin = createDb(testDatabaseUrl, { maxConnections: 1 });
      try {
        const existing = await admin.db.execute(
          sql`select 1 from pg_database where datname = ${apiDatabase}`,
        );
        if (existing.length === 0) {
          await admin.db.execute(sql.raw(`create database "${apiDatabase.replace(/"/g, '""')}"`));
        }
      } finally {
        await admin.close();
      }

      ({ db, close } = createDb(apiUrl.toString(), { maxConnections: 2 }));
      await db.execute(sql`drop schema if exists drizzle cascade`);
      await db.execute(sql`drop schema if exists public cascade`);
      await db.execute(sql`create schema public`);
      await runMigrations(db);
      await seedSynthetic(db, { now: NOW });
      await seedSynthetic(db, { now: NOW }); // re-seeding must be idempotent
      app = createApp({
        getDb: () => db,
        allowedOrigins: [APP_ORIGIN],
        allowedOriginPattern: PREVIEW_PATTERN,
        now: () => NOW, // the seed's clock; the wall clock would leave NOW's week next Monday
      });
    }, 30_000);

    afterAll(async () => {
      await close?.();
    });

    it("GET /v1/meta returns the seeded version, attribution, and the CDN cache header", async () => {
      const response = await app.request("/v1/meta");
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL_PUBLIC);
      const body = metaResponseSchema.parse(await response.json());
      expect(body).toEqual({
        dataVersion: 1,
        lastRatedAt: "2026-10-03T11:06:00.000Z",
        attribution: ATTRIBUTION,
      });
    });

    it("GET /v1/status shows the latest run per job with times and ok/failed only", async () => {
      const response = await app.request("/v1/status");
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL_PUBLIC);
      const text = await response.text();
      const body = statusResponseSchema.parse(JSON.parse(text));
      expect(body.attribution).toBe(ATTRIBUTION);
      expect(body.jobs.map((job) => [job.job, job.ok])).toEqual([
        ["discover", true],
        ["sync", true], // the newer success wins over the older failure
        ["backfill", false],
        ["rate", true],
      ]);
      // The seeded failed runs carry error text; none of it may leak.
      expect(text).not.toMatch(/Synthetic|timed out|complexity|error|requests/i);
    });

    it("GET /v1/status reports null for a job that has never run", async () => {
      await db.execute(sql`delete from ingest_runs where job = 'discover'`);
      try {
        const body = statusResponseSchema.parse(await (await app.request("/v1/status")).json());
        expect(body.jobs[0]).toEqual({
          job: "discover",
          lastRunAt: null,
          lastFinishedAt: null,
          ok: null,
        });
      } finally {
        await seedSynthetic(db, { now: NOW });
      }
    });

    it("rejects unexpected query parameters with 400 and no-store (no CDN cache busting)", async () => {
      for (const path of ["/v1/meta?x=1", "/v1/status?cachebust=abc"]) {
        const response = await app.request(path);
        expect(response.status).toBe(400);
        expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL_NO_STORE);
        expect(errorResponseSchema.parse(await response.json()).error).toBe(
          "Unexpected query parameters",
        );
      }
    });

    it("keepExistingMeta leaves existing meta values untouched", async () => {
      await db.update(meta).set({ value: "42" }).where(eq(meta.key, "data_version"));
      try {
        await seedSynthetic(db, { now: NOW, keepExistingMeta: true });
        const body = metaResponseSchema.parse(await (await app.request("/v1/meta")).json());
        expect(body.dataVersion).toBe(42);
      } finally {
        await seedSynthetic(db, { now: NOW });
      }
    });

    it("GET / is a small uncached health body", async () => {
      const response = await app.request("/");
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL_NO_STORE);
      expect(await response.json()).toEqual({
        name: "smash-rankings-api",
        ok: true,
        attribution: ATTRIBUTION,
      });
    });

    it("unknown routes return a 404 JSON body that is never cached", async () => {
      const response = await app.request("/v1/players-export");
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL_NO_STORE);
      expect(errorResponseSchema.parse(await response.json()).attribution).toBe(ATTRIBUTION);
    });

    it("server errors return generic JSON with no-store", async () => {
      const broken = createApp({
        getDb: () => {
          throw new Error("connection refused with secret details");
        },
        allowedOrigins: [],
      });
      const response = await broken.request("/v1/meta");
      expect(response.status).toBe(500);
      expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL_NO_STORE);
      const text = await response.text();
      expect(errorResponseSchema.parse(JSON.parse(text)).error).toBe("Internal server error");
      expect(text).not.toContain("secret");
    });

    it("CORS allows listed origins and rejects unknown ones", async () => {
      const allowed = await app.request("/v1/meta", { headers: { Origin: APP_ORIGIN } });
      expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(APP_ORIGIN);
      expect(allowed.headers.get("Vary")).toMatch(/Origin/);

      const unknown = await app.request("/v1/meta", {
        headers: { Origin: "https://evil.example" },
      });
      expect(unknown.headers.get("Access-Control-Allow-Origin")).toBeNull();

      const preview = "https://sr-app-git-feat-x.example.test";
      const fromPreview = await app.request("/v1/meta", { headers: { Origin: preview } });
      expect(fromPreview.headers.get("Access-Control-Allow-Origin")).toBe(preview);
      const lookalike = await app.request("/v1/meta", {
        headers: { Origin: "https://sr-app-x.example.test.evil.example" },
      });
      expect(lookalike.headers.get("Access-Control-Allow-Origin")).toBeNull();

      const preflight = await app.request("/v1/meta", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" },
      });
      expect(preflight.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(preflight.headers.get("Cache-Control")).toBe(CACHE_CONTROL_NO_STORE);
    });

    describe("leaderboard, players, search", () => {
      const dash = SYNTHETIC_ID_MIN + 4; // Sample_Dash, rank 1 in the seed
      const ace = SYNTHETIC_ID_MIN + 1; // Sample_Ace, unranked: 9 of 10 sets
      const ember = SYNTHETIC_ID_MIN + 30; // Sample_Ember, RD 118: never eligible
      const alias = SYNTHETIC_ID_MIN + 900_001;
      const json = async (path: string) => (await app.request(path)).json();

      beforeAll(async () => {
        // Extra rows live in the synthetic id range, so the next seed removes them.
        await db
          .update(players)
          .set({ prefix: "SMP", userSlug: "user/sample-dash" })
          .where(eq(players.id, dash));
        await db.insert(players).values([
          { id: alias, gamerTag: "Sample_Dash_Alt", mergedInto: dash },
          { id: alias + 1, gamerTag: "Sample_Dash_Old", mergedInto: alias },
        ]);
      });

      it("lists only eligible players, in rank order, with asOf and dataVersion", async () => {
        const body = leaderboardResponseSchema.parse(await json("/v1/leaderboard"));
        const eligible = await db.execute(
          sql`select count(*)::int as n from leaderboard where rank is not null`,
        );
        expect(body.entries.length).toBe(eligible[0]?.n);
        expect(body.entries.map((entry) => entry.rank)).toEqual(
          body.entries.map((_, index) => index + 1),
        );
        expect(body.entries[0]).toMatchObject({
          playerId: String(dash),
          gamerTag: "Sample_Dash",
          prefix: "SMP",
          conservativeScore: 1808,
        });
        expect(body).toMatchObject({ asOf: "2026-10-03T11:06:00.000Z", dataVersion: 1 });
        expect(body.entries.some((entry) => entry.playerId === String(ember))).toBe(false);
      });

      it("allows limit 1..100 in one spelling and rejects everything else", async () => {
        expect(
          leaderboardResponseSchema.parse(await json("/v1/leaderboard?limit=1")).entries,
        ).toHaveLength(1);
        const top = await app.request("/v1/leaderboard?limit=100");
        expect(top.status).toBe(200);
        expect(
          leaderboardResponseSchema.parse(await top.json()).entries.length,
        ).toBeLessThanOrEqual(100);
        // Over the cap, or another spelling of a valid value, would be a new cache key.
        for (const limit of [
          "1000",
          "101",
          "1000000000000000",
          "0005",
          "abc",
          "0",
          "-1",
          "1.5",
          "5&limit=6",
        ]) {
          expect((await app.request(`/v1/leaderboard?limit=${limit}`)).status).toBe(400);
        }
      });

      it("returns a ranked player with record, recent results, and start.gg link", async () => {
        const body = playerResponseSchema.parse(await json(`/v1/players/${dash}`));
        expect(body).toMatchObject({
          gamerTag: "Sample_Dash",
          startggUrl: "https://www.start.gg/user/sample-dash",
          rank: 1,
          eligible: true,
          notRankedReason: null,
          conservativeScore: 1808,
          qualifyingEvents: 3,
        });
        expect(body.setRecord.wins + body.setRecord.losses).toBe(body.ratedSets);
        expect(
          body.recentResults.map((result) => [result.tournamentName, result.entrants]),
        ).toEqual([
          ["Sample Regional", 96],
          ["Sample Invitational", 64],
          ["Sample Showdown", 32],
        ]);
      });

      it("explains why an unranked player is not ranked", async () => {
        const short = playerResponseSchema.parse(await json(`/v1/players/${ace}`));
        expect(short).toMatchObject({ rank: null, eligible: false, startggUrl: null });
        expect(short.notRankedReason).toEqual({
          setsNeeded: 1,
          eventsNeeded: 0,
          uncertaintyTooHigh: false,
        });
        const uncertain = playerResponseSchema.parse(await json(`/v1/players/${ember}`));
        expect(uncertain.notRankedReason?.uncertaintyTooHigh).toBe(true);
      });

      it("counts the set record over the ranking window, without DQs", async () => {
        const before = playerResponseSchema.parse(await json(`/v1/players/${dash}`)).setRecord;
        const base = { eventId: SYNTHETIC_ID_MIN + 1, winnerId: dash, loserId: ember };
        const asOf = periodIndexFor(new Date("2026-10-03T11:06:00Z")); // seeded last_rated_at
        await db.insert(sets).values([
          { ...base, id: SYNTHETIC_ID_MIN + 900_001, ratingPeriod: asOf, isDq: true },
          { ...base, id: SYNTHETIC_ID_MIN + 900_002, ratingPeriod: asOf - 52 }, // just outside
          { ...base, id: SYNTHETIC_ID_MIN + 900_003, ratingPeriod: asOf - 51 }, // first week in
          { ...base, id: SYNTHETIC_ID_MIN + 900_004, ratingPeriod: asOf },
          // Played after the last rating run: the ranking hasn't seen it yet.
          { ...base, id: SYNTHETIC_ID_MIN + 900_005, ratingPeriod: asOf + 1 },
        ]);
        const after = playerResponseSchema.parse(await json(`/v1/players/${dash}`)).setRecord;
        expect(after).toEqual({ wins: before.wins + 2, losses: before.losses });
      });

      it("redirects merged aliases (even chains) to the main player with 301", async () => {
        for (const id of [alias, alias + 1]) {
          const response = await app.request(`/v1/players/${id}`);
          expect(response.status).toBe(301);
          expect(response.headers.get("Location")).toBe(`/v1/players/${dash}`);
        }
      });

      it("returns 404 for an unknown player and 400 for a malformed id", async () => {
        expect((await app.request(`/v1/players/${SYNTHETIC_ID_MIN + 999_999}`)).status).toBe(404);
        for (const id of ["abc", "12a", "-5", "0", "09000000000004", "1234567890123456"]) {
          const response = await app.request(`/v1/players/${id}`);
          expect(response.status).toBe(400);
          expect(errorResponseSchema.parse(await response.json()).error).toBe("Invalid player id");
        }
      });

      it("searches tags case-insensitively, ranked first, without merged aliases", async () => {
        const body = searchResponseSchema.parse(await json("/v1/search?q=sample_dash"));
        expect(body.results).toEqual([
          { playerId: String(dash), gamerTag: "Sample_Dash", prefix: "SMP", rank: 1 },
        ]);
        const many = searchResponseSchema.parse(await json("/v1/search?q=le_"));
        // 12 ranked players in rank order, then unranked ones by tag.
        expect(many.results).toHaveLength(20);
        expect(many.results.map((result) => result.rank)).toEqual([
          ...Array.from({ length: 12 }, (_, index) => index + 1),
          ...Array<null>(8).fill(null),
        ]);
        expect(many.results[12]?.gamerTag).toBe("Sample_Ace");
        const unranked = searchResponseSchema.parse(await json("/v1/search?q=er"));
        expect(unranked.results.map((result) => [result.gamerTag, result.rank])).toEqual([
          ["Sample_Cinder", null],
          ["Sample_Ember", null],
        ]);
      });

      it("treats %, _ and backslash in a search as plain characters", async () => {
        for (const q of ["%a", "p_e", "\\_"]) {
          const response = await app.request(`/v1/search?q=${encodeURIComponent(q)}`);
          expect(searchResponseSchema.parse(await response.json()).results).toEqual([]);
        }
      });

      it("rejects short searches and redirects un-normalized ones to one cache key", async () => {
        // Too short, a NUL or other control character, or broken percent-encoding.
        for (const q of ["a", "%20%20b%20", "", "a%00b", "ab%1F", "ab%zz", "ab%E0%A4%A"]) {
          const response = await app.request(`/v1/search?q=${q}`);
          expect(response.status, q).toBe(400);
          expect(errorResponseSchema.parse(await response.json()).error).toBe("Invalid q");
        }
        for (const q of ["%20%20ACE%20", "Ace", "a%63e"]) {
          const response = await app.request(`/v1/search?q=${q}`);
          expect(response.status).toBe(301);
          expect(response.headers.get("Location")).toBe("/v1/search?q=ace");
        }
        // Already canonical (URLSearchParams form, as hc sends it): no redirect.
        for (const q of ["mk+leo", "o'neil", "o%27neil"]) {
          expect((await app.request(`/v1/search?q=${q}`)).status, q).toBe(200);
        }
        expect((await app.request("/v1/search?q=mk%20leo")).headers.get("Location")).toBe(
          "/v1/search?q=mk+leo",
        );
      });

      it("rejects unexpected query parameters on every read endpoint", async () => {
        for (const path of [
          "/v1/leaderboard?x=1",
          "/v1/leaderboard?limit=5&page=2",
          "/v1/search?q=ace&x=1",
          "/v1/search",
          `/v1/players/${ace}?x=1`,
        ]) {
          const response = await app.request(path);
          expect(response.status, path).toBe(400);
          expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL_NO_STORE);
        }
      });

      it("every response carries attribution; only 200s get the CDN cache header", async () => {
        const paths = [
          "/v1/leaderboard",
          `/v1/players/${ace}`,
          `/v1/players/${ember}`,
          "/v1/search?q=ace",
        ];
        for (const path of [
          ...paths,
          "/v1/leaderboard?limit=x",
          "/v1/players/1",
          "/v1/search?q=a",
        ]) {
          const response = await app.request(path);
          const cacheable = paths.includes(path);
          expect(response.status === 200, path).toBe(cacheable);
          expect(response.headers.get("Cache-Control")).toBe(
            cacheable ? CACHE_CONTROL_PUBLIC : CACHE_CONTROL_NO_STORE,
          );
          expect(await response.json()).toMatchObject({ attribution: ATTRIBUTION });
        }
      });

      it("the typed client reaches every route", async () => {
        const client = createApiClient("http://localhost", {
          fetch: (...args: Parameters<typeof fetch>) => app.request(...args),
        });
        const board = await client.v1.leaderboard.$get({ query: { limit: 2 } });
        expect(leaderboardResponseSchema.parse(await board.json()).entries).toHaveLength(2);
        const player = await client.v1.players[":id"].$get({ param: { id: String(dash) } });
        expect(player.status).toBe(200);
        const search = await client.v1.search.$get({ query: { q: "ace" } });
        expect(searchResponseSchema.parse(await search.json()).results[0]?.gamerTag).toBe(
          "Sample_Ace",
        );
      });
    });

    describe("dashboard", () => {
      const syn = (offset: number) => SYNTHETIC_ID_MIN + offset;
      const tag = (player: { gamerTag: string }) => player.gamerTag;
      const MONDAY = new Date("2026-09-28T00:00:00.000Z"); // NOW's week starts here
      const period = periodIndexFor(NOW);
      const dashboard = async () => {
        const response = await app.request("/v1/dashboard");
        expect(response.status).toBe(200);
        expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL_PUBLIC);
        return dashboardResponseSchema.parse(await response.json());
      };
      /** Adds a one-event tournament in the synthetic range (the next seed removes it). */
      async function addEvent(
        offset: number,
        startAt: Date,
        { qualifies = true, numEntrants = 20 }: { qualifies?: boolean; numEntrants?: number } = {},
      ) {
        await db.insert(tournaments).values({
          id: syn(offset),
          slug: `tournament/test-${offset}`,
          name: `Sample Test ${offset}`,
          startAt,
          countryCode: "US",
          region: "TX",
        });
        await db.insert(events).values({
          id: syn(offset),
          tournamentId: syn(offset),
          slug: `tournament/test-${offset}/event/singles`,
          name: "Ultimate Singles",
          startAt,
          numEntrants,
          qualifies,
        });
        return syn(offset);
      }
      const player = (index: number) => syn(index + 1); // TAG_WORDS index -> seeded id
      const [halo, lumen, wisp] = [player(7), player(11), player(22)];
      const reseed = () => seedSynthetic(db, { now: NOW });

      // Earlier tests add rows to the seed; start from a clean one.
      beforeAll(reseed);

      it("fills every section from the seed, in order", async () => {
        const body = await dashboard();
        expect(body.header).toEqual({
          year: 2026,
          weekStart: "2026-09-28",
          weekEnd: "2026-10-04",
          lastUpdated: "2026-10-03T11:06:00.000Z",
        });
        expect(body.attribution).toBe(ATTRIBUTION);

        // Top 10 copies the leaderboard's first 10 entries.
        const board = leaderboardResponseSchema.parse(
          await (await app.request("/v1/leaderboard?limit=10")).json(),
        );
        expect(body.top10).toEqual(
          board.entries.map(
            ({ rank, playerId, gamerTag, prefix, conservativeScore, rankDelta7d }) => ({
              rank,
              playerId,
              gamerTag,
              prefix,
              conservativeScore,
              rankDelta7d,
            }),
          ),
        );
        expect(body.top10.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect(body.top10[0]).toMatchObject({ gamerTag: "Sample_Dash", conservativeScore: 1808 });

        // Ties on the delta go to the better rank.
        expect(body.movers.climbers.map((row) => [tag(row), row.rankDelta7d, row.rank])).toEqual([
          ["Sample_Tide", 2, 8],
          ["Sample_Yarrow", 2, 12],
          ["Sample_Dash", 1, 1],
        ]);
        expect(body.movers.fallers.map((row) => [tag(row), row.rankDelta7d, row.rank])).toEqual([
          ["Sample_Kite", -2, 3],
          ["Sample_Lumen", -1, 4],
          ["Sample_Vex", -1, 9],
        ]);

        // The seeded DQ (Yarrow over Nova, gap 260) is not an upset.
        expect(
          body.upsets.map((row) => [tag(row.winner), tag(row.loser), row.score, row.ratingGap]),
        ).toEqual([
          ["Sample_Wisp", "Sample_Lumen", "3-2", 220],
          ["Sample_Wisp", "Sample_Nova", "3-2", 180],
          ["Sample_Sage", "Sample_Lumen", "2-1", 140],
          ["Sample_Xeno", "Sample_Vex", "2-1", 40],
        ]);
        expect(body.upsets[0]).toMatchObject({
          winner: { playerId: String(wisp), prefix: null },
          loser: { playerId: String(lumen) },
          eventName: "Ultimate Singles",
          tournamentName: "Sample Arcadian",
        });
        for (const upset of body.upsets) {
          expect(new Date(upset.completedAt) >= MONDAY && new Date(upset.completedAt) <= NOW).toBe(
            true,
          );
        }

        expect(
          body.weekEvents.map((row) => [
            row.tournamentName,
            row.city,
            row.numEntrants,
            row.winner?.gamerTag,
          ]),
        ).toEqual([
          ["Sample Weekly", "San Antonio", 24, "Sample_Halo"],
          ["Sample Arcadian", null, 16, "Sample_Wisp"],
        ]);
        expect(body.weekEventCount).toBe(2);
        expect(body.weekEvents[0]).toMatchObject({
          startAt: "2026-09-29T09:00:00.000Z",
          startggUrl: "https://www.start.gg/tournament/synthetic-4/event/ultimate-singles",
          winner: { playerId: String(halo), gamerTag: "Sample_Halo", prefix: null },
        });

        expect(body.year).toEqual({
          eventCount: 5,
          totalEntrants: 32 + 64 + 96 + 24 + 16,
          uniquePlayers: 30,
          biggestEvent: {
            eventId: String(syn(3)),
            eventName: "Ultimate Singles",
            tournamentName: "Sample Regional",
            numEntrants: 96,
            startggUrl: "https://www.start.gg/tournament/synthetic-3/event/ultimate-singles",
          },
          mostWins: {
            player: { playerId: String(player(0)), gamerTag: "Sample_Ace", prefix: null },
            wins: 3,
          },
        });
      });

      it("upsets skip DQs, non-qualifying events, unrated players and last week; merge aliases", async () => {
        try {
          const newcomer = syn(800_001);
          const wispAlias = syn(800_002);
          const late = syn(800_003); // rated only in the current week
          await db.insert(players).values([
            { id: newcomer, gamerTag: "Sample_Newcomer" },
            { id: wispAlias, gamerTag: "Sample_Wisp_Alt", mergedInto: wisp },
            { id: late, gamerTag: "Sample_Late" },
          ]);
          await db
            .insert(ratingHistory)
            .values({ playerId: late, period, rating: 1000, rd: 100, volatility: 0.06 });
          const thisWeek = await addEvent(800_010, new Date("2026-09-29T10:00:00Z"));
          const offline = await addEvent(800_011, new Date("2026-09-29T10:00:00Z"), {
            qualifies: false,
          });
          const lastWeek = await addEvent(800_012, new Date("2026-09-26T10:00:00Z"));
          const set = (
            offset: number,
            eventId: number,
            winnerId: number,
            loserId: number,
            completedAt: Date,
            extra: Partial<typeof sets.$inferInsert> = {},
          ) => ({
            id: syn(800_000 + offset),
            eventId,
            winnerId,
            loserId,
            winnerGames: 2,
            loserGames: 1,
            completedAt,
            ratingPeriod: periodIndexFor(completedAt),
            ...extra,
          });
          const tuesday = new Date("2026-09-29T12:00:00Z");
          const sundayNight = new Date("2026-09-27T23:59:59Z");
          await db.insert(sets).values([
            // Gap 300 each (Wisp 1560 vs Halo 1860), but none of these count:
            set(1, thisWeek, wisp, halo, tuesday, {
              isDq: true,
              winnerGames: null,
              loserGames: null,
            }),
            set(2, offline, wisp, halo, tuesday),
            set(3, lastWeek, wisp, halo, sundayNight),
            set(4, thisWeek, newcomer, halo, tuesday), // newcomer has no rating yet
            set(5, thisWeek, late, halo, tuesday), // only a rating from this week
            // Counts, as Wisp (the alias's main player), gap 300, and from Monday 00:00 on.
            set(6, thisWeek, wispAlias, halo, MONDAY, { winnerGames: null, loserGames: null }),
          ]);
          const { upsets, year } = await dashboard();
          expect(upsets.map((row) => [row.setId, tag(row.winner), tag(row.loser)])).toEqual([
            [String(syn(800_006)), "Sample_Wisp", "Sample_Halo"],
            ["9000000000146", "Sample_Wisp", "Sample_Lumen"],
            ["9000000000142", "Sample_Wisp", "Sample_Nova"],
            ["9000000000137", "Sample_Sage", "Sample_Lumen"],
            ["9000000000141", "Sample_Xeno", "Sample_Vex"],
          ]);
          expect(upsets[0]).toMatchObject({
            winner: { playerId: String(wisp) },
            score: null,
            ratingGap: 300,
            completedAt: MONDAY.toISOString(),
          });
          // Newcomer and Late played rated sets this year; the alias is Wisp, already counted.
          expect(year.uniquePlayers).toBe(32);
        } finally {
          await reseed();
        }
      });

      it("uses the latest rating before this week when last week has none", async () => {
        try {
          // Wisp sat out last week: only older rows exist. The newest of them counts.
          await db.execute(
            sql`delete from rating_history where player_id = ${wisp} and period = ${period - 1}`,
          );
          await db.insert(ratingHistory).values([
            { playerId: wisp, period: period - 3, rating: 1700, rd: 80, volatility: 0.06 },
            { playerId: wisp, period: period - 5, rating: 1000, rd: 80, volatility: 0.06 },
          ]);
          const { upsets } = await dashboard();
          expect(upsets.map((row) => [tag(row.winner), tag(row.loser), row.ratingGap])).toEqual([
            ["Sample_Sage", "Sample_Lumen", 140],
            ["Sample_Wisp", "Sample_Lumen", 80], // 1780 - 1700
            ["Sample_Xeno", "Sample_Vex", 40],
            ["Sample_Wisp", "Sample_Nova", 40], // 1740 - 1700; ties go to the lower set id
          ]);
        } finally {
          await reseed();
        }
      });

      it("breaks equal gaps by set id", async () => {
        try {
          const eventId = await addEvent(800_020, new Date("2026-09-29T10:00:00Z"));
          const completedAt = new Date("2026-09-29T12:00:00Z");
          const base = {
            eventId,
            completedAt,
            ratingPeriod: period,
            winnerGames: 2,
            loserGames: 0,
          };
          await db.insert(sets).values([
            { ...base, id: syn(800_022), winnerId: player(24), loserId: player(4) }, // 1520 vs 1920
            { ...base, id: syn(800_021), winnerId: player(23), loserId: player(3) }, // 1540 vs 1940
          ]);
          const { upsets } = await dashboard();
          expect(upsets.slice(0, 2).map((row) => [row.setId, row.ratingGap])).toEqual([
            [String(syn(800_021)), 400],
            [String(syn(800_022)), 400],
          ]);
        } finally {
          await reseed();
        }
      });

      it("this week runs from Monday 00:00 UTC to Sunday 24:00; this year stops at now", async () => {
        try {
          const monday = await addEvent(800_030, MONDAY, { numEntrants: 500 });
          await addEvent(800_031, new Date("2026-09-27T23:59:00Z")); // previous Sunday
          await addEvent(800_032, new Date("2026-10-05T00:00:00Z")); // next Monday
          const upcoming = await addEvent(800_033, new Date("2026-10-04T23:59:00Z"));
          await addEvent(800_034, new Date("2026-09-30T00:00:00Z"), { qualifies: false });
          const newYear = await addEvent(800_035, new Date("2026-01-01T00:00:00Z"));
          await addEvent(800_036, new Date("2025-12-31T23:59:59Z"));
          // Halo also wins two events this year: 3 wins, tied with Ace, who has the lower id.
          await db.insert(standings).values([
            { eventId: newYear, playerId: halo, placement: 1 },
            { eventId: monday, playerId: halo, placement: 1 },
            { eventId: monday, playerId: lumen, placement: 1 }, // shared 1st: lowest id shown
          ]);

          const { weekEvents, weekEventCount, year } = await dashboard();
          expect(weekEventCount).toBe(4);
          expect(weekEvents.map((row) => [row.eventId, row.winner?.gamerTag ?? null])).toEqual([
            [String(monday), "Sample_Halo"],
            [String(syn(4)), "Sample_Halo"],
            [String(syn(5)), "Sample_Wisp"],
            [String(upcoming), null], // later this week, no winner yet
          ]);
          // In: the 5 seeded events, Monday's, the previous Sunday's and January 1's.
          // Out: next Monday, upcoming (not started yet), non-qualifying, and last year's.
          expect(year.eventCount).toBe(8);
          expect(year.totalEntrants).toBe(232 + 500 + 20 + 20);
          expect(year.biggestEvent).toMatchObject({ eventId: String(monday), numEntrants: 500 });
          expect(year.mostWins).toEqual({
            player: { playerId: String(player(0)), gamerTag: "Sample_Ace", prefix: null },
            wins: 3,
          });
        } finally {
          await reseed();
        }
      });

      it("an empty database gives empty sections, not errors", async () => {
        try {
          await db.execute(sql`delete from sets`);
          await db.execute(sql`delete from standings`);
          await db.execute(sql`delete from rating_history`);
          await db.execute(sql`delete from leaderboard`);
          await db.execute(sql`delete from events`);
          await db.execute(sql`delete from tournaments`);
          await db.execute(sql`delete from players`);
          await db.execute(sql`delete from meta`);
          const body = await dashboard();
          expect(body).toEqual({
            header: {
              year: 2026,
              weekStart: "2026-09-28",
              weekEnd: "2026-10-04",
              lastUpdated: null,
            },
            top10: [],
            movers: { climbers: [], fallers: [] },
            upsets: [],
            weekEvents: [],
            weekEventCount: 0,
            year: {
              eventCount: 0,
              totalEntrants: 0,
              uniquePlayers: 0,
              biggestEvent: null,
              mostWins: null,
            },
            attribution: ATTRIBUTION,
          });
        } finally {
          await reseed();
        }
      });

      it("uses the request time: a Monday 00:00 request starts a new, empty week", async () => {
        const nextMonday = createApp({
          getDb: () => db,
          allowedOrigins: [],
          now: () => new Date("2026-10-05T00:00:00Z"),
        });
        const body = dashboardResponseSchema.parse(
          await (await nextMonday.request("/v1/dashboard")).json(),
        );
        expect(body.header).toMatchObject({ weekStart: "2026-10-05", weekEnd: "2026-10-11" });
        // Last week's seeded events and sets now belong to the previous week.
        expect(body.weekEvents).toEqual([]);
        expect(body.weekEventCount).toBe(0);
        expect(body.upsets).toEqual([]);
      });

      it("caps the week's events at 20 and reports the full count", async () => {
        try {
          for (let index = 0; index < 19; index++) {
            await addEvent(800_200 + index, new Date(Date.UTC(2026, 8, 30, 10, index)));
          }
          await addEvent(800_250, new Date("2026-09-30T11:00:00Z"), { qualifies: false });
          const { weekEvents, weekEventCount } = await dashboard();
          expect(weekEvents).toHaveLength(20);
          expect(weekEventCount).toBe(21); // 2 seeded + 19 added; the non-qualifying one is out
        } finally {
          await reseed();
        }
      });

      it("an upset needs a gap that rounds to at least 1", async () => {
        try {
          const ids = [1, 2, 3, 4].map((offset) => syn(800_300 + offset));
          const [lowA, highA, lowB, highB] = ids as [number, number, number, number];
          await db
            .insert(players)
            .values(ids.map((id, index) => ({ id, gamerTag: `Sample_Close${index}` })));
          const rating = (playerId: number, value: number) => ({
            playerId,
            period: period - 1,
            rating: value,
            rd: 80,
            volatility: 0.06,
          });
          await db
            .insert(ratingHistory)
            .values([
              rating(lowA, 1500),
              rating(highA, 1500.4),
              rating(lowB, 1500),
              rating(highB, 1500.5),
            ]);
          const eventId = await addEvent(800_310, new Date("2026-09-29T10:00:00Z"));
          const base = {
            eventId,
            completedAt: new Date("2026-09-29T12:00:00Z"),
            ratingPeriod: period,
            winnerGames: 2,
            loserGames: 1,
          };
          // Alone, the 0.4 gap would be the 5th upset (the seed has 4); it must not show as "gap 0".
          await db
            .insert(sets)
            .values({ ...base, id: syn(800_311), winnerId: lowA, loserId: highA });
          const before = await dashboard();
          expect(before.upsets.map((row) => row.ratingGap)).toEqual([220, 180, 140, 40]);
          // A 0.5 gap rounds to 1 and counts.
          await db
            .insert(sets)
            .values({ ...base, id: syn(800_312), winnerId: lowB, loserId: highB });
          const { upsets } = await dashboard();
          expect(upsets.map((row) => [row.setId, row.ratingGap])).toEqual([
            ["9000000000146", 220],
            ["9000000000142", 180],
            ["9000000000137", 140],
            ["9000000000141", 40],
            [String(syn(800_312)), 1],
          ]);
        } finally {
          await reseed();
        }
      });

      it("leaves out players whose merge chain is longer than 5 hops, as the player page does", async () => {
        try {
          // chain[k] is an alias k hops from Wisp: chain[5] still resolves, chain[6] does not.
          const chain = [wisp, 1, 2, 3, 4, 5, 6].map((k) => (k === wisp ? wisp : syn(800_400 + k)));
          for (let k = 1; k <= 6; k++) {
            await db.insert(players).values({
              id: chain[k] as number,
              gamerTag: `Sample_Hop${k}`,
              mergedInto: chain[k - 1] as number,
            });
          }
          const [hop1, hop5, hop6] = [chain[1], chain[5], chain[6]] as [number, number, number];
          // Without the check, hop6 would end on hop1 (still an alias) with this low rating.
          await db.insert(ratingHistory).values(
            [hop1, hop6].map((playerId) => ({
              playerId,
              period: period - 1,
              rating: 1000,
              rd: 80,
              volatility: 0.06,
            })),
          );
          const thisWeek = await addEvent(800_410, new Date("2026-09-29T10:00:00Z"));
          const tuesday = new Date("2026-09-29T12:00:00Z");
          const base = { eventId: thisWeek, completedAt: tuesday, ratingPeriod: period };
          await db.insert(sets).values([
            {
              ...base,
              id: syn(800_411),
              winnerId: hop6,
              loserId: halo,
              winnerGames: 2,
              loserGames: 0,
            },
            {
              ...base,
              id: syn(800_412),
              winnerId: hop5,
              loserId: halo,
              winnerGames: 2,
              loserGames: 1,
            },
          ]);
          // hop6 "wins" four events this year: more than Ace's 3, if it counted.
          const earlier = await Promise.all(
            [1, 2, 3].map((index) =>
              addEvent(800_420 + index, new Date(Date.UTC(2026, 5, index, 12))),
            ),
          );
          await db
            .insert(standings)
            .values(
              [thisWeek, ...earlier].map((eventId) => ({ eventId, playerId: hop6, placement: 1 })),
            );

          expect((await app.request(`/v1/players/${hop6}`)).status).toBe(404);
          expect((await app.request(`/v1/players/${hop5}`)).status).not.toBe(404);

          const { upsets, weekEvents, year } = await dashboard();
          // hop5 counts as Wisp (gap 1860 - 1560 = 300); hop6's set is left out.
          expect(upsets[0]).toMatchObject({
            setId: String(syn(800_412)),
            winner: { playerId: String(wisp), gamerTag: "Sample_Wisp" },
            ratingGap: 300,
          });
          const shownIds = upsets.flatMap((row) => [row.winner.playerId, row.loser.playerId]);
          expect(shownIds).not.toContain(String(hop1));
          expect(shownIds).not.toContain(String(hop6));
          expect(weekEvents.find((row) => row.eventId === String(thisWeek))?.winner).toBeNull();
          expect(year.mostWins).toEqual({
            player: { playerId: String(player(0)), gamerTag: "Sample_Ace", prefix: null },
            wins: 3,
          });
          expect(year.uniquePlayers).toBe(30); // hop5 is Wisp and Halo is seeded: no one new
        } finally {
          await reseed();
        }
      });

      describe("the seed fills every section whenever it runs", () => {
        it.each([
          ["a Monday just after midnight", "2026-09-28T00:00:30Z", 2026, "2026-09-28"],
          ["a Friday whose week began last year", "2027-01-01T00:00:30Z", 2027, "2026-12-28"],
        ])("%s (%s)", async (_label, seedTime, year, weekStart) => {
          const seedNow = new Date(seedTime);
          try {
            await seedSynthetic(db, { now: seedNow });
            const seeded = createApp({ getDb: () => db, allowedOrigins: [], now: () => seedNow });
            const response = await seeded.request("/v1/dashboard");
            expect(response.status).toBe(200);
            const body = dashboardResponseSchema.parse(await response.json());
            expect(body.header).toMatchObject({ year, weekStart });
            expect(body.upsets.length).toBeGreaterThan(0);
            expect(body.weekEvents.length).toBeGreaterThan(0);
            expect(body.movers.climbers.length).toBeGreaterThan(0);
            expect(body.movers.fallers.length).toBeGreaterThan(0);
            expect(body.year.eventCount).toBeGreaterThan(0);
            expect(body.year.totalEntrants).toBeGreaterThan(0);
            expect(body.year.uniquePlayers).toBeGreaterThan(0);
            expect(body.year.biggestEvent).not.toBeNull();
            expect(body.year.mostWins).not.toBeNull();
          } finally {
            await reseed();
          }
        });
      });

      it("rejects query parameters and works through the typed client", async () => {
        const response = await app.request("/v1/dashboard?year=2025");
        expect(response.status).toBe(400);
        expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL_NO_STORE);
        const client = createApiClient("http://localhost", {
          fetch: (...args: Parameters<typeof fetch>) => app.request(...args),
        });
        const viaClient = await client.v1.dashboard.$get();
        expect(dashboardResponseSchema.parse(await viaClient.json()).top10).toHaveLength(10);
      });
    });
  },
);
