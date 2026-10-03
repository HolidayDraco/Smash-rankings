import {
  ATTRIBUTION,
  errorResponseSchema,
  INGEST_JOBS,
  metaResponseSchema,
  statusResponseSchema,
  type JobStatus,
} from "@sr/core";
import { ingestRuns, meta, type Database } from "@sr/db";
import { desc, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { z } from "zod";

/** Data changes at most hourly; a long CDN cache keeps Neon asleep (P1-6). */
export const CACHE_CONTROL_PUBLIC = "public, s-maxage=900, stale-while-revalidate=86400";
export const CACHE_CONTROL_NO_STORE = "no-store";

const healthResponseSchema = z.strictObject({
  name: z.literal("smash-rankings-api"),
  ok: z.literal(true),
  attribution: z.literal(ATTRIBUTION),
});

export interface AppOptions {
  /** Returns the shared Drizzle instance; called per request, so it can be lazy. */
  getDb: () => Database;
  /** Exact origins (scheme + host + port) allowed to call the API from a browser. */
  allowedOrigins: readonly string[];
  /** Optional anchored regex for extra origins, e.g. Vercel preview URLs of the app. */
  allowedOriginPattern?: RegExp | undefined;
}

export function createApp({ getDb, allowedOrigins, allowedOriginPattern }: AppOptions) {
  const isAllowedOrigin = (origin: string) =>
    allowedOrigins.includes(origin) || (allowedOriginPattern?.test(origin) ?? false);

  // These endpoints take no parameters. Rejecting stray query strings stops
  // anyone from busting the CDN cache (and waking the database) with ?x=random.
  const rejectQueryParams = createMiddleware(async (c, next) => {
    if (new URL(c.req.url).search !== "") {
      return c.json(
        errorResponseSchema.parse({
          error: "Unexpected query parameters",
          attribution: ATTRIBUTION,
        }),
        400,
      );
    }
    await next();
  });

  return (
    new Hono()
      // Cache only successful /v1 reads; everything else (errors, health, CORS
      // preflights) must never be stored by the CDN.
      .use("*", async (c, next) => {
        await next();
        const cacheable = c.res.status === 200 && c.req.path.startsWith("/v1/");
        c.header("Cache-Control", cacheable ? CACHE_CONTROL_PUBLIC : CACHE_CONTROL_NO_STORE);
      })
      .use(
        "*",
        cors({
          origin: (origin) => (isAllowedOrigin(origin) ? origin : null),
          allowMethods: ["GET", "HEAD", "OPTIONS"],
          maxAge: 86_400,
        }),
      )
      .get("/", (c) =>
        c.json(
          healthResponseSchema.parse({
            name: "smash-rankings-api",
            ok: true,
            attribution: ATTRIBUTION,
          }),
        ),
      )
      .get("/v1/meta", rejectQueryParams, async (c) => {
        const rows = await getDb()
          .select({ key: meta.key, value: meta.value })
          .from(meta)
          .where(inArray(meta.key, ["data_version", "last_rated_at"]));
        const byKey = new Map(rows.map((row) => [row.key, row.value]));
        const dataVersion = byKey.get("data_version");
        const lastRatedAt = byKey.get("last_rated_at");
        return c.json(
          metaResponseSchema.parse({
            dataVersion: dataVersion === undefined ? null : Number(dataVersion),
            lastRatedAt: lastRatedAt === undefined ? null : new Date(lastRatedAt).toISOString(),
            attribution: ATTRIBUTION,
          }),
        );
      })
      .get("/v1/status", rejectQueryParams, async (c) => {
        // Latest run per job; only the columns we are willing to show publicly.
        const latest = await getDb()
          .selectDistinctOn([ingestRuns.job], {
            job: ingestRuns.job,
            startedAt: ingestRuns.startedAt,
            finishedAt: ingestRuns.finishedAt,
            status: ingestRuns.status,
          })
          .from(ingestRuns)
          .orderBy(ingestRuns.job, desc(ingestRuns.startedAt), desc(ingestRuns.id));
        const jobs = INGEST_JOBS.map((job): JobStatus => {
          const run = latest.find((row) => row.job === job);
          return {
            job,
            lastRunAt: run?.startedAt.toISOString() ?? null,
            lastFinishedAt: run?.finishedAt?.toISOString() ?? null,
            // "partial" means the run hit its time budget and will resume: not a failure.
            ok: !run || run.status === "running" ? null : run.status !== "error",
          };
        });
        return c.json(statusResponseSchema.parse({ jobs, attribution: ATTRIBUTION }));
      })
      .notFound((c) =>
        c.json(errorResponseSchema.parse({ error: "Not found", attribution: ATTRIBUTION }), 404),
      )
      .onError((error, c) => {
        console.error("Unhandled API error:", error instanceof Error ? error.name : "unknown");
        return c.json(
          errorResponseSchema.parse({ error: "Internal server error", attribution: ATTRIBUTION }),
          500,
        );
      })
  );
}

/** For the typed Hono RPC client (`hc<AppType>`), added in P1-7. */
export type AppType = ReturnType<typeof createApp>;
