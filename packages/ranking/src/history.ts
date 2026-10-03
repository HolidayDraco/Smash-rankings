import { DEFAULT_GLICKO2_CONFIG, ratePeriod } from "./glicko2";
import type { Glicko2Config, PlayerId, PlayerRating } from "./glicko2";

/** A stored set: `period` is the integer week index (see `periodIndexFor`). */
export interface PeriodSet {
  winnerId: PlayerId;
  loserId: PlayerId;
  period: number;
  eventId: string;
  isDq?: boolean;
}

/** Merged accounts: alias player id → main player id. Chains are followed. */
export type AliasMap = ReadonlyMap<PlayerId, PlayerId>;

export function resolveAlias(id: PlayerId, aliases: AliasMap | undefined): PlayerId {
  if (!aliases) return id;
  let current = id;
  for (let hops = 0; hops <= aliases.size; hops += 1) {
    const next = aliases.get(current);
    if (next === undefined || next === current) return current;
    current = next;
  }
  throw new Error(`resolveAlias: alias cycle involving ${id}`);
}

/**
 * The sets that count: aliases resolved to the main player, DQs dropped, and
 * self-sets (same player on both sides after merging) dropped.
 */
export function countedSets(sets: readonly PeriodSet[], aliases?: AliasMap): PeriodSet[] {
  const counted: PeriodSet[] = [];
  for (const set of sets) {
    if (set.isDq === true) continue;
    if (!Number.isSafeInteger(set.period)) {
      throw new RangeError(`countedSets: period must be an integer, got ${set.period}`);
    }
    const winnerId = resolveAlias(set.winnerId, aliases);
    const loserId = resolveAlias(set.loserId, aliases);
    if (winnerId === loserId) continue;
    counted.push({ winnerId, loserId, period: set.period, eventId: set.eventId });
  }
  return counted;
}

export interface RateHistoryInput {
  sets: readonly PeriodSet[];
  /** First and last period to rate, inclusive. Sets outside the range are ignored. */
  fromPeriod: number;
  toPeriod: number;
  aliases?: AliasMap;
  config?: Glicko2Config;
  /**
   * "every-week" (default): a row per player per period from their first set on.
   * "active-weeks": only rows with setsPlayed > 0, plus every player's row for
   * `toPeriod`. Idle weeks can be rebuilt from these (RD growth only), so this
   * is what the rate job stores.
   */
  historyRows?: "every-week" | "active-weeks";
}

/** One `rating_history` row: a player's rating at the end of a period. */
export interface HistoryRow extends PlayerRating {
  playerId: PlayerId;
  period: number;
  setsPlayed: number;
}

export interface RateHistoryResult {
  /** Ratings after `toPeriod`, keyed in ascending player-id order. */
  ratings: Map<PlayerId, PlayerRating>;
  /** Sorted by period, then player id. Which rows: see `RateHistoryInput.historyRows`. */
  history: HistoryRow[];
}

/**
 * Rate every week from `fromPeriod` to `toPeriod`. Everyone starts fresh at
 * the defaults when they play their first set; after that, a week without
 * sets only grows their RD. Runs in O(periods × players + sets).
 */
export function rateHistory(input: RateHistoryInput): RateHistoryResult {
  const { fromPeriod, toPeriod, aliases, config = DEFAULT_GLICKO2_CONFIG } = input;
  const activeOnly = input.historyRows === "active-weeks";
  if (!Number.isSafeInteger(fromPeriod) || !Number.isSafeInteger(toPeriod)) {
    throw new RangeError("rateHistory: fromPeriod and toPeriod must be integers");
  }
  if (fromPeriod > toPeriod) throw new RangeError("rateHistory: fromPeriod is after toPeriod");

  const setsByPeriod = new Map<number, PeriodSet[]>();
  for (const set of countedSets(input.sets, aliases)) {
    if (set.period < fromPeriod || set.period > toPeriod) continue;
    const list = setsByPeriod.get(set.period);
    if (list) list.push(set);
    else setsByPeriod.set(set.period, [set]);
  }

  let ratings = new Map<PlayerId, PlayerRating>();
  const history: HistoryRow[] = [];
  for (let period = fromPeriod; period <= toPeriod; period += 1) {
    const periodSets = setsByPeriod.get(period) ?? [];
    const setsPlayed = new Map<PlayerId, number>();
    for (const { winnerId, loserId } of periodSets) {
      setsPlayed.set(winnerId, (setsPlayed.get(winnerId) ?? 0) + 1);
      setsPlayed.set(loserId, (setsPlayed.get(loserId) ?? 0) + 1);
    }
    // ratePeriod returns everyone already rated (RD inflation if idle) plus
    // newcomers, in ascending id order, so history rows come out sorted.
    ratings = ratePeriod(ratings, periodSets, config);
    for (const [playerId, rating] of ratings) {
      const played = setsPlayed.get(playerId) ?? 0;
      if (activeOnly && played === 0 && period !== toPeriod) continue;
      history.push({ playerId, period, ...rating, setsPlayed: played });
    }
  }
  return { ratings, history };
}

/** Everyone's rating at the end of `period`, from `rateHistory`'s history rows (with "active-weeks", only `toPeriod` is complete). */
export function ratingsAt(
  history: readonly HistoryRow[],
  period: number,
): Map<PlayerId, PlayerRating> {
  const ratings = new Map<PlayerId, PlayerRating>();
  for (const row of history) {
    if (row.period !== period) continue;
    const { rating, ratingDeviation, volatility } = row;
    ratings.set(row.playerId, { rating, ratingDeviation, volatility });
  }
  return ratings;
}
