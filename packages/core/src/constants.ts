/** start.gg's id for Super Smash Bros. Ultimate. */
export const ULTIMATE_VIDEOGAME_ID = 1386;

/** Shown on every screen and API response that carries start.gg data (start.gg API ToS). */
export const ATTRIBUTION = "Data from start.gg";

/** Which events count toward ratings (blueprint decisions 2 and 3). */
export const QUALIFYING_EVENT_RULES = {
  minEntrants: 64,
  allowOnline: false,
  singlesOnly: true,
} as const;

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
