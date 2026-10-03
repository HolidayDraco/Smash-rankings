/** start.gg's id for Super Smash Bros. Ultimate. */
export const ULTIMATE_VIDEOGAME_ID = 1386;

/** Shown on every screen and API response that carries start.gg data (start.gg API ToS). */
export const ATTRIBUTION = "Data from start.gg";

/** Which events count toward ratings (blueprint decisions 2 and 3). */
export const QUALIFYING_EVENT_RULES = {
  /** ADR-0003: 16 and up, so Texas locals count (was 64). */
  minEntrants: 16,
  allowOnline: false,
  singlesOnly: true,
} as const;

/**
 * Where we ingest and rate events (ADR-0003). Launch is Texas only. To add a state, add its
 * two-letter code to `states` and its full name to `STATE_NAMES` (a test checks both), then
 * re-run discover over the last 12 months (see docs/startgg-notes.md). No other code changes.
 * `countryCode` is the start.gg `Tournament.countryCode` every listed state belongs to.
 */
export const LAUNCH_REGIONS = {
  countryCode: "US",
  states: ["TX"],
} as const satisfies { countryCode: string; states: readonly string[] };

/**
 * Full names accepted for a state, because start.gg's `Tournament.addrState` format
 * (code or full name) is unverified. Add a name here when adding a state to `LAUNCH_REGIONS`.
 */
export const STATE_NAMES: Readonly<Record<string, string>> = { TX: "Texas" };

/** Who appears on the ranked leaderboard (ADR-0002). */
export const LEADERBOARD_ELIGIBILITY = {
  minRatedSets: 10,
  minQualifyingEvents: 3,
  maxRatingDeviation: 110,
  trailingMonths: 12,
  /** The 12-month window in whole rating periods (weeks) for set and event counts. */
  trailingWeeks: 52,
} as const;

/** Client-side ceiling for start.gg requests (their hard limit is 80 per 60 s). */
export const STARTGG_MAX_REQUESTS_PER_MINUTE = 60;
