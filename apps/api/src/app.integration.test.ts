import {
  ATTRIBUTION,
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
import { meta, players, sets } from "@sr/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CACHE_CONTROL_NO_STORE, CACHE_CONTROL_PUBLIC, createApp } from "./app";
import { createApiClient } from "./client";
import { periodIndexFor } from "@sr/ranking";

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
          ["Sample Regional", 128],
          ["Sample Invitational", 96],
          ["Sample Showdown", 64],
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
  },
);
