import { z } from "zod";
import { ATTRIBUTION } from "./constants";

/** Every API body carries the start.gg attribution (API ToS). */
const attributionField = z.literal(ATTRIBUTION);

/** ISO-8601 timestamp string, or null when unknown. */
const isoTimestamp = z.iso.datetime({ offset: true });

export const INGEST_JOBS = ["discover", "sync", "backfill", "rate"] as const;
export type IngestJob = (typeof INGEST_JOBS)[number];

/** `GET /v1/meta`: when the rankings were last rebuilt. */
export const metaResponseSchema = z.strictObject({
  dataVersion: z.number().int().nonnegative().nullable(),
  lastRatedAt: isoTimestamp.nullable(),
  attribution: attributionField,
});
export type MetaResponse = z.infer<typeof metaResponseSchema>;

/**
 * `GET /v1/status`: latest run per job. Public on purpose, so it carries only
 * times and ok/failed: never error text, request counts, or other internals.
 * `ok` is null while a run is still going or when a job has never run.
 */
export const jobStatusSchema = z.strictObject({
  job: z.enum(INGEST_JOBS),
  lastRunAt: isoTimestamp.nullable(),
  lastFinishedAt: isoTimestamp.nullable(),
  ok: z.boolean().nullable(),
});
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const statusResponseSchema = z.strictObject({
  jobs: z.array(jobStatusSchema).length(INGEST_JOBS.length),
  attribution: attributionField,
});
export type StatusResponse = z.infer<typeof statusResponseSchema>;

/** Body of every 404 and 500. Deliberately generic: no stack traces or internals. */
export const errorResponseSchema = z.strictObject({
  error: z.string(),
  attribution: attributionField,
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/** start.gg ids travel as digit strings so they never lose precision in JS clients. */
const playerIdField = z.string().regex(/^\d+$/);

/** List caps: nothing may page past the top 100 (start.gg ToS: no bulk export). */
export const LEADERBOARD_MAX_LIMIT = 100;
export const SEARCH_MIN_QUERY_LENGTH = 2;
export const SEARCH_MAX_QUERY_LENGTH = 50;
export const SEARCH_MAX_RESULTS = 20;
export const PLAYER_RECENT_RESULTS = 10;

/** `GET /v1/leaderboard?limit=`: the top eligible players, ordered by rank. */
export const leaderboardEntrySchema = z.strictObject({
  rank: z.number().int().positive(),
  playerId: playerIdField,
  gamerTag: z.string(),
  prefix: z.string().nullable(),
  countryCode: z.string().nullable(),
  /** Rating minus two times rating deviation, rounded. */
  conservativeScore: z.number().int(),
  rating: z.number(),
  ratingDeviation: z.number().nonnegative(),
  rankDelta7d: z.number().int().nullable(),
  lastActiveAt: isoTimestamp.nullable(),
});

export const leaderboardResponseSchema = z.strictObject({
  entries: z.array(leaderboardEntrySchema).max(LEADERBOARD_MAX_LIMIT),
  asOf: isoTimestamp.nullable(),
  dataVersion: z.number().int().nonnegative().nullable(),
  attribution: attributionField,
});
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;

/** Why a player is not on the leaderboard yet (thresholds: LEADERBOARD_ELIGIBILITY). */
export const notRankedReasonSchema = z.strictObject({
  setsNeeded: z.number().int().nonnegative(),
  eventsNeeded: z.number().int().nonnegative(),
  uncertaintyTooHigh: z.boolean(),
});
export type NotRankedReason = z.infer<typeof notRankedReasonSchema>;

export const playerResultSchema = z.strictObject({
  eventId: playerIdField,
  eventName: z.string(),
  tournamentName: z.string(),
  date: isoTimestamp.nullable(),
  placement: z.number().int().positive(),
  entrants: z.number().int().nonnegative().nullable(),
});

/** `GET /v1/players/:id`. Rating fields are null when the player has never been rated. */
export const playerResponseSchema = z.strictObject({
  playerId: playerIdField,
  gamerTag: z.string(),
  prefix: z.string().nullable(),
  countryCode: z.string().nullable(),
  /** Only https links on www.start.gg, because the app opens this URL. */
  startggUrl: z.url({ protocol: /^https$/, hostname: /^www\.start\.gg$/ }).nullable(),
  rank: z.number().int().positive().nullable(),
  eligible: z.boolean(),
  notRankedReason: notRankedReasonSchema.nullable(),
  conservativeScore: z.number().int().nullable(),
  rating: z.number().nullable(),
  ratingDeviation: z.number().nonnegative().nullable(),
  ratedSets: z.number().int().nonnegative(),
  qualifyingEvents: z.number().int().nonnegative(),
  /**
   * Non-DQ sets from qualifying events in the ranking window: the 52 rating
   * weeks ending with the week of the last rating run (as for ratedSets).
   */
  setRecord: z.strictObject({
    wins: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
  }),
  recentResults: z.array(playerResultSchema).max(PLAYER_RECENT_RESULTS),
  attribution: attributionField,
});
export type PlayerResponse = z.infer<typeof playerResponseSchema>;

/** `GET /v1/search?q=`: ranked players first (by rank), then the rest by tag. */
export const searchResultSchema = z.strictObject({
  playerId: playerIdField,
  gamerTag: z.string(),
  prefix: z.string().nullable(),
  rank: z.number().int().positive().nullable(),
});

export const searchResponseSchema = z.strictObject({
  query: z.string().min(SEARCH_MIN_QUERY_LENGTH).max(SEARCH_MAX_QUERY_LENGTH),
  results: z.array(searchResultSchema).max(SEARCH_MAX_RESULTS),
  attribution: attributionField,
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
