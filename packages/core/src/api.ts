import { z } from "zod";
import { ATTRIBUTION } from "./constants";

/** Every API body carries the start.gg attribution (API ToS). */
const attributionField = z.literal(ATTRIBUTION);

/** ISO-8601 timestamp string, or null when unknown. */
const isoTimestamp = z.iso.datetime({ offset: true });

/** Only https links on www.start.gg, because the app opens these URLs. */
const startggUrlField = z.url({ protocol: /^https$/, hostname: /^www\.start\.gg$/ });

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
const startggIdField = z.string().regex(/^\d+$/);

/** List caps: nothing may page past the top 100 (start.gg ToS: no bulk export). */
export const LEADERBOARD_MAX_LIMIT = 100;
export const SEARCH_MIN_QUERY_LENGTH = 2;
export const SEARCH_MAX_QUERY_LENGTH = 50;
export const SEARCH_MAX_RESULTS = 20;
export const PLAYER_RECENT_RESULTS = 10;

/** `GET /v1/leaderboard?limit=`: the top eligible players, ordered by rank. */
export const leaderboardEntrySchema = z.strictObject({
  rank: z.number().int().positive(),
  playerId: startggIdField,
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
  eventId: startggIdField,
  eventName: z.string(),
  tournamentName: z.string(),
  date: isoTimestamp.nullable(),
  placement: z.number().int().positive(),
  entrants: z.number().int().nonnegative().nullable(),
});

/** `GET /v1/players/:id`. Rating fields are null when the player has never been rated. */
export const playerResponseSchema = z.strictObject({
  playerId: startggIdField,
  gamerTag: z.string(),
  prefix: z.string().nullable(),
  countryCode: z.string().nullable(),
  startggUrl: startggUrlField.nullable(),
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
  playerId: startggIdField,
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

/** Section sizes for `GET /v1/dashboard`. All small on purpose (start.gg ToS: no bulk lists). */
export const DASHBOARD_TOP_COUNT = 10;
export const DASHBOARD_MOVERS_COUNT = 3;
export const DASHBOARD_UPSETS_COUNT = 5;
export const DASHBOARD_WEEK_EVENTS_MAX = 20;

/** Enough to show a player and link to their page (the link is built from id + tag). */
export const dashboardPlayerSchema = z.strictObject({
  playerId: startggIdField,
  gamerTag: z.string(),
  prefix: z.string().nullable(),
});
export type DashboardPlayer = z.infer<typeof dashboardPlayerSchema>;

/** A top-10 row: the leaderboard entry, trimmed. `rankDelta7d` null means new this week. */
export const dashboardTopEntrySchema = z.strictObject({
  rank: z.number().int().positive(),
  playerId: startggIdField,
  gamerTag: z.string(),
  prefix: z.string().nullable(),
  /** Rating minus two times rating deviation, rounded (as on the leaderboard). */
  conservativeScore: z.number().int(),
  rankDelta7d: z.number().int().nullable(),
});

/** A climber (delta > 0) or faller (delta < 0) among currently ranked players. */
export const dashboardMoverSchema = z.strictObject({
  rank: z.number().int().positive(),
  playerId: startggIdField,
  gamerTag: z.string(),
  prefix: z.string().nullable(),
  rankDelta7d: z
    .number()
    .int()
    .refine((delta) => delta !== 0),
});

/**
 * A set this week where the winner's rating at the start of the week was lower than
 * the loser's. `ratingGap` is loser minus winner, rounded; `score` is "3-1" or null.
 */
export const dashboardUpsetSchema = z.strictObject({
  setId: startggIdField,
  winner: dashboardPlayerSchema,
  loser: dashboardPlayerSchema,
  score: z
    .string()
    .regex(/^\d+-\d+$/)
    .nullable(),
  eventName: z.string(),
  tournamentName: z.string(),
  /** At least 1: gaps that would round to 0 are not upsets. */
  ratingGap: z.number().int().positive(),
  completedAt: isoTimestamp,
});

/** A qualifying event starting this week. `winner` is null until a 1st place is known. */
export const dashboardWeekEventSchema = z.strictObject({
  eventId: startggIdField,
  eventName: z.string(),
  tournamentName: z.string(),
  city: z.string().nullable(),
  startAt: isoTimestamp,
  numEntrants: z.number().int().nonnegative().nullable(),
  winner: dashboardPlayerSchema.nullable(),
  startggUrl: startggUrlField,
});

/** Totals for qualifying events that started this calendar year (UTC), up to now. */
export const dashboardYearSchema = z.strictObject({
  eventCount: z.number().int().nonnegative(),
  totalEntrants: z.number().int().nonnegative(),
  uniquePlayers: z.number().int().nonnegative(),
  biggestEvent: z
    .strictObject({
      eventId: startggIdField,
      eventName: z.string(),
      tournamentName: z.string(),
      numEntrants: z.number().int().nonnegative(),
      startggUrl: startggUrlField,
    })
    .nullable(),
  mostWins: z
    .strictObject({
      player: dashboardPlayerSchema,
      wins: z.number().int().positive(),
    })
    .nullable(),
});

/**
 * `GET /v1/dashboard`: "Texas Smash, <year>" plus this week. The week is the current rating
 * period: Monday 00:00 UTC up to (not including) the next Monday. `weekStart` is that Monday
 * and `weekEnd` the Sunday, both as YYYY-MM-DD. Every list may be empty.
 */
export const dashboardResponseSchema = z.strictObject({
  header: z.strictObject({
    year: z.number().int(),
    weekStart: z.iso.date(),
    weekEnd: z.iso.date(),
    /** Same as `GET /v1/meta` lastRatedAt. */
    lastUpdated: isoTimestamp.nullable(),
  }),
  top10: z.array(dashboardTopEntrySchema).max(DASHBOARD_TOP_COUNT),
  movers: z.strictObject({
    climbers: z.array(dashboardMoverSchema).max(DASHBOARD_MOVERS_COUNT),
    fallers: z.array(dashboardMoverSchema).max(DASHBOARD_MOVERS_COUNT),
  }),
  upsets: z.array(dashboardUpsetSchema).max(DASHBOARD_UPSETS_COUNT),
  weekEvents: z.array(dashboardWeekEventSchema).max(DASHBOARD_WEEK_EVENTS_MAX),
  /** How many events match in total; more than `weekEvents.length` means "and N more". */
  weekEventCount: z.number().int().nonnegative(),
  year: dashboardYearSchema,
  attribution: attributionField,
});
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
