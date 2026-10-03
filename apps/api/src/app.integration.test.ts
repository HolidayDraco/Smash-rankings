import {
  ATTRIBUTION,
  errorResponseSchema,
  metaResponseSchema,
  statusResponseSchema,
} from "@sr/core";
import { createDb, type Database } from "@sr/db";
import { runMigrations } from "@sr/db/migrate";
import { seedSynthetic } from "@sr/db/seed";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CACHE_CONTROL_NO_STORE, CACHE_CONTROL_PUBLIC, createApp } from "./app";

// A throwaway Postgres server. This suite uses its own sibling database
// (`<name>_api`) because @sr/db's tests drop the main one's schema in parallel.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// CI must always run this suite; a silent skip would hide a broken database setup.
if (process.env.CI && !testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL must be set in CI");
}

const APP_ORIGIN = "https://app.example.test";
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
      await seedSynthetic(db, NOW);
      await seedSynthetic(db, NOW); // re-seeding must be idempotent
      app = createApp({ getDb: () => db, allowedOrigins: [APP_ORIGIN] });
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
        await seedSynthetic(db, NOW);
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

      const preflight = await app.request("/v1/meta", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" },
      });
      expect(preflight.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(preflight.headers.get("Cache-Control")).toBe(CACHE_CONTROL_NO_STORE);
    });
  },
);
