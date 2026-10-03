import {
  ATTRIBUTION,
  errorResponseSchema,
  INGEST_JOBS,
  LEADERBOARD_MAX_LIMIT,
  leaderboardResponseSchema,
  metaResponseSchema,
  playerResponseSchema,
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MIN_QUERY_LENGTH,
  searchResponseSchema,
  statusResponseSchema,
  type JobStatus,
} from "@sr/core";
import { ingestRuns, type Database } from "@sr/db";
import { periodIndexFor } from "@sr/core";
import { desc } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { validator } from "hono/validator";
import { z } from "zod";
import {
  notRankedReason,
  readLeaderboard,
  readMeta,
  readPlayer,
  resolveMainPlayerId,
  searchPlayers,
} from "./queries";

/** Data changes at most hourly; a long CDN cache keeps Neon asleep (P1-6). */
export const CACHE_CONTROL_PUBLIC = "public, s-maxage=900, stale-while-revalidate=86400";
export const CACHE_CONTROL_NO_STORE = "no-store";

const healthResponseSchema = z.strictObject({
  name: z.literal("smash-rankings-api"),
  ok: z.literal(true),
  attribution: z.literal(ATTRIBUTION),
});

const errorBody = (error: string) => errorResponseSchema.parse({ error, attribution: ATTRIBUTION });
const badRequest = (c: Context, error: string) => c.json(errorBody(error), 400);

/** Unknown keys mean cache busting; anything else is a malformed value. */
function queryError(error: z.ZodError) {
  const issue = error.issues[0];
  return issue?.code === "unrecognized_keys"
    ? "Unexpected query parameters"
    : `Invalid ${issue?.path.join(".") ?? "query"}`;
}

/** Validates the query string; strict schemas reject extra keys (no CDN cache busting). */
const validQuery = <T extends z.ZodType<Record<string, unknown>>>(schema: T) =>
  validator("query", (value, c) => {
    const parsed = schema.safeParse(value);
    return parsed.success ? (parsed.data as z.output<T>) : badRequest(c, queryError(parsed.error));
  });

const leaderboardQuerySchema = z.strictObject({
  // One spelling per value (no "0005", no 101+), so limit can't mint extra cache keys.
  limit: z
    .string()
    .regex(/^[1-9]\d{0,2}$/)
    .transform(Number)
    .pipe(z.number().max(LEADERBOARD_MAX_LIMIT))
    .optional(),
});
const searchQuerySchema = z.strictObject({ q: z.string() });
/** Digits only, and short enough to stay an exact JS number. */
const playerIdSchema = z.string().regex(/^[1-9]\d{0,14}$/);

// Matching control characters is the point here (e.g. a NUL makes Postgres error out).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Hono passes malformed escapes like "%zz" through as text; treat them as a bad request. */
function isValidPercentEncoding(search: string) {
  try {
    decodeURIComponent(search.replace(/\+/g, " "));
    return true;
  } catch {
    return false;
  }
}

const isoOrNull = (date: Date | null) => date?.toISOString() ?? null;

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
    if (new URL(c.req.url).search !== "") return badRequest(c, "Unexpected query parameters");
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
        const { dataVersion, lastRatedAt } = await readMeta(getDb());
        return c.json(
          metaResponseSchema.parse({
            dataVersion,
            lastRatedAt: isoOrNull(lastRatedAt),
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
      .get("/v1/leaderboard", validQuery(leaderboardQuerySchema), async (c) => {
        // Anything above 100 is a 400: there is no way past the top 100.
        const limit = c.req.valid("query").limit ?? LEADERBOARD_MAX_LIMIT;
        const db = getDb();
        const [rows, { dataVersion, lastRatedAt }] = await Promise.all([
          readLeaderboard(db, limit),
          readMeta(db),
        ]);
        return c.json(
          leaderboardResponseSchema.parse({
            entries: rows.map(({ playerId, conservativeScore, rd, lastActiveAt, ...row }) => ({
              ...row,
              playerId: String(playerId),
              conservativeScore: Math.round(conservativeScore),
              ratingDeviation: rd,
              lastActiveAt: isoOrNull(lastActiveAt),
            })),
            asOf: isoOrNull(lastRatedAt),
            dataVersion,
            attribution: ATTRIBUTION,
          }),
        );
      })
      .get(
        "/v1/players/:id",
        rejectQueryParams,
        validator("param", (value, c) => {
          const parsed = playerIdSchema.safeParse(value.id);
          return parsed.success ? { id: Number(parsed.data) } : badRequest(c, "Invalid player id");
        }),
        async (c) => {
          const { id } = c.req.valid("param");
          const db = getDb();
          const mainId = await resolveMainPlayerId(db, id);
          if (mainId === null) return c.json(errorBody("Not found"), 404);
          // A merged alias permanently points at its main player.
          if (mainId !== id) return c.redirect(`/v1/players/${mainId}`, 301);

          const { lastRatedAt } = await readMeta(db);
          const found = await readPlayer(db, id, periodIndexFor(lastRatedAt ?? new Date()));
          if (!found) return c.json(errorBody("Not found"), 404);
          const { player, record, recentResults } = found;
          const rated = player.rating !== null;
          return c.json(
            playerResponseSchema.parse({
              playerId: String(id),
              gamerTag: player.gamerTag,
              prefix: player.prefix,
              countryCode: player.countryCode,
              startggUrl: player.userSlug ? `https://www.start.gg/${player.userSlug}` : null,
              rank: player.rank,
              eligible: player.eligible ?? false,
              notRankedReason:
                player.rank === null
                  ? notRankedReason(player.setsPlayed ?? 0, player.eventsPlayed ?? 0, player.rd)
                  : null,
              conservativeScore: rated ? Math.round(player.conservativeScore ?? 0) : null,
              rating: player.rating,
              ratingDeviation: player.rd,
              ratedSets: player.setsPlayed ?? 0,
              qualifyingEvents: player.eventsPlayed ?? 0,
              setRecord: record,
              recentResults: recentResults.map((result) => ({
                ...result,
                eventId: String(result.eventId),
                date: isoOrNull(result.date),
              })),
              attribution: ATTRIBUTION,
            }),
          );
        },
      )
      .get("/v1/search", validQuery(searchQuerySchema), async (c) => {
        const query = c.req.valid("query").q.trim().toLowerCase();
        const search = new URL(c.req.url).search;
        if (
          query.length < SEARCH_MIN_QUERY_LENGTH ||
          query.length > SEARCH_MAX_QUERY_LENGTH ||
          CONTROL_CHARACTERS.test(query) ||
          !isValidPercentEncoding(search)
        ) {
          return badRequest(c, "Invalid q");
        }
        // The CDN keys on the raw query string, so send every spelling of one
        // search ("  ACE ", "Ace") to a single canonical, cacheable URL. That
        // form is URLSearchParams' (space as "+"), which is what hc sends.
        const canonical = `?${new URLSearchParams({ q: query }).toString()}`;
        if (search !== canonical) {
          return c.redirect(`/v1/search${canonical}`, 301);
        }
        const rows = await searchPlayers(getDb(), query);
        return c.json(
          searchResponseSchema.parse({
            query,
            results: rows.map((row) => ({ ...row, playerId: String(row.playerId) })),
            attribution: ATTRIBUTION,
          }),
        );
      })
      .notFound((c) => c.json(errorBody("Not found"), 404))
      .onError((error, c) => {
        console.error("Unhandled API error:", error instanceof Error ? error.name : "unknown");
        return c.json(errorBody("Internal server error"), 500);
      })
  );
}

/** Route types for the Hono RPC client (`createApiClient` in ./client). */
export type AppType = ReturnType<typeof createApp>;
