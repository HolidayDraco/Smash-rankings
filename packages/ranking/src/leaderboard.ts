import { LEADERBOARD_ELIGIBILITY } from "@sr/core";
import type { PlayerId, PlayerRating } from "./glicko2";
import { countedSets, resolveAlias } from "./history";
import type { AliasMap, PeriodSet } from "./history";

/** Bottom of the ~95% interval: r − 2·RD. The leaderboard sort key. */
export function conservativeScore(
  rating: Pick<PlayerRating, "rating" | "ratingDeviation">,
): number {
  return rating.rating - 2 * rating.ratingDeviation;
}

/** Counts are for the trailing window (12 months by default); the caller computes them. */
export interface EligibilityStats {
  ratedSets: number;
  qualifyingEvents: number;
  ratingDeviation: number;
}

export interface EligibilityRules {
  minRatedSets: number;
  minQualifyingEvents: number;
  maxRatingDeviation: number;
}

export function isEligible(
  stats: EligibilityStats,
  rules: EligibilityRules = LEADERBOARD_ELIGIBILITY,
): boolean {
  return (
    stats.ratedSets >= rules.minRatedSets &&
    stats.qualifyingEvents >= rules.minQualifyingEvents &&
    stats.ratingDeviation <= rules.maxRatingDeviation
  );
}

export interface LeaderboardInput {
  playerId: PlayerId;
  rating: number;
  ratingDeviation: number;
}

export type RankedEntry<T extends LeaderboardInput> = T & {
  rank: number;
  conservativeScore: number;
};

/**
 * Sort by conservative score (desc), then rating (desc), then player id (asc),
 * and assign ranks 1..n. The id tie-breaker makes the order total, so every
 * entry gets a distinct rank. Duplicate player ids are rejected.
 */
export function rankLeaderboard<T extends LeaderboardInput>(
  entries: readonly T[],
): RankedEntry<T>[] {
  const seen = new Set<PlayerId>();
  for (const { playerId } of entries) {
    if (seen.has(playerId)) throw new Error(`rankLeaderboard: duplicate playerId ${playerId}`);
    seen.add(playerId);
  }
  return entries
    .map((entry) => ({ ...entry, conservativeScore: conservativeScore(entry) }))
    .sort(
      (a, b) =>
        b.conservativeScore - a.conservativeScore ||
        b.rating - a.rating ||
        (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0),
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/** A player's place in an event's standings (they entered even if every set was a DQ). */
export interface StandingsEvent {
  playerId: PlayerId;
  eventId: string;
  period: number;
}

export interface EligibilityStatsInput {
  /** Sets from qualifying events only. DQs and self-sets are not counted. */
  sets: readonly PeriodSet[];
  /** Optional extra event entries, unioned with the events seen in `sets`. */
  standingsEvents?: readonly StandingsEvent[];
  asOfPeriod: number;
  /** Window length in periods, ending at `asOfPeriod` inclusive. */
  trailingWeeks?: number;
  aliases?: AliasMap;
}

export interface PlayerActivity {
  ratedSets: number;
  qualifyingEvents: number;
  /** Latest period at or before `asOfPeriod` with a counted set; null if none. */
  lastActivePeriod: number | null;
}

/**
 * Set and event counts inside the trailing window
 * (asOfPeriod − trailingWeeks, asOfPeriod]. Anything after `asOfPeriod` is ignored.
 */
export function eligibilityStats(input: EligibilityStatsInput): Map<PlayerId, PlayerActivity> {
  const { asOfPeriod, trailingWeeks = LEADERBOARD_ELIGIBILITY.trailingWeeks, aliases } = input;
  if (!Number.isSafeInteger(asOfPeriod) || !Number.isSafeInteger(trailingWeeks)) {
    throw new RangeError("eligibilityStats: asOfPeriod and trailingWeeks must be integers");
  }
  const firstPeriod = asOfPeriod - trailingWeeks + 1;
  const sets = new Map<PlayerId, number>();
  const events = new Map<PlayerId, Set<string>>();
  const lastActive = new Map<PlayerId, number>();
  const addEvent = (id: PlayerId, eventId: string): void => {
    const seen = events.get(id);
    if (seen) seen.add(eventId);
    else events.set(id, new Set([eventId]));
  };

  for (const set of countedSets(input.sets, aliases)) {
    if (set.period > asOfPeriod) continue;
    for (const id of [set.winnerId, set.loserId]) {
      lastActive.set(id, Math.max(lastActive.get(id) ?? set.period, set.period));
      if (set.period < firstPeriod) continue;
      sets.set(id, (sets.get(id) ?? 0) + 1);
      addEvent(id, set.eventId);
    }
  }
  for (const entry of input.standingsEvents ?? []) {
    if (entry.period >= firstPeriod && entry.period <= asOfPeriod) {
      addEvent(resolveAlias(entry.playerId, aliases), entry.eventId);
    }
  }

  const ids = [...new Set([...lastActive.keys(), ...events.keys()])].sort();
  return new Map(
    ids.map((id) => [
      id,
      {
        ratedSets: sets.get(id) ?? 0,
        qualifyingEvents: events.get(id)?.size ?? 0,
        lastActivePeriod: lastActive.get(id) ?? null,
      },
    ]),
  );
}

export interface BuildLeaderboardInput {
  ratings: ReadonlyMap<PlayerId, PlayerRating>;
  stats: ReadonlyMap<PlayerId, PlayerActivity>;
  /** Ranks from the run 7 days ago (one period earlier). Null or missing = unranked then. */
  previousRanks?: ReadonlyMap<PlayerId, number | null>;
  rules?: EligibilityRules;
}

export interface LeaderboardRow {
  playerId: PlayerId;
  /** Null when not eligible. */
  rank: number | null;
  conservativeScore: number;
  rating: number;
  ratingDeviation: number;
  eligible: boolean;
  ratedSets: number;
  qualifyingEvents: number;
  lastActivePeriod: number | null;
  /** previousRank − rank (positive = moved up); null if unranked now or 7 days ago. */
  rankDelta7d: number | null;
}

/**
 * One row per rated player: eligible players first in `rankLeaderboard`
 * order with ranks 1..n, then ineligible players (rank null) in the same order.
 */
export function buildLeaderboard(input: BuildLeaderboardInput): LeaderboardRow[] {
  const { ratings, stats, previousRanks, rules = LEADERBOARD_ELIGIBILITY } = input;
  const eligible: LeaderboardInput[] = [];
  const ineligible: LeaderboardInput[] = [];
  for (const [playerId, { rating, ratingDeviation }] of ratings) {
    const activity = stats.get(playerId);
    const counts = {
      ratedSets: activity?.ratedSets ?? 0,
      qualifyingEvents: activity?.qualifyingEvents ?? 0,
    };
    const target = isEligible({ ...counts, ratingDeviation }, rules) ? eligible : ineligible;
    target.push({ playerId, rating, ratingDeviation });
  }

  const toRow = (entry: RankedEntry<LeaderboardInput>, isRanked: boolean): LeaderboardRow => {
    const activity = stats.get(entry.playerId);
    const rank = isRanked ? entry.rank : null;
    const previousRank = previousRanks?.get(entry.playerId) ?? null;
    return {
      playerId: entry.playerId,
      rank,
      conservativeScore: entry.conservativeScore,
      rating: entry.rating,
      ratingDeviation: entry.ratingDeviation,
      eligible: isRanked,
      ratedSets: activity?.ratedSets ?? 0,
      qualifyingEvents: activity?.qualifyingEvents ?? 0,
      lastActivePeriod: activity?.lastActivePeriod ?? null,
      rankDelta7d: rank !== null && previousRank !== null ? previousRank - rank : null,
    };
  };
  return [
    ...rankLeaderboard(eligible).map((entry) => toRow(entry, true)),
    ...rankLeaderboard(ineligible).map((entry) => toRow(entry, false)),
  ];
}
