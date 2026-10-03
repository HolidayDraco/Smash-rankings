import { LEADERBOARD_ELIGIBILITY } from "@sr/core";
import type { PlayerId, PlayerRating } from "./glicko2";

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
