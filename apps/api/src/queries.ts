/* Read queries behind the /v1 endpoints. Each one is backed by an existing index. */
import {
  LEADERBOARD_ELIGIBILITY,
  PLAYER_RECENT_RESULTS,
  SEARCH_MAX_RESULTS,
  type NotRankedReason,
} from "@sr/core";
import {
  events,
  leaderboard,
  meta,
  players,
  sets,
  standings,
  tournaments,
  type Database,
} from "@sr/db";
import { and, asc, desc, eq, gte, ilike, lte, inArray, isNotNull, isNull, sql } from "drizzle-orm";

const MAX_MERGE_HOPS = 5;

export async function readMeta(db: Database) {
  const rows = await db
    .select({ key: meta.key, value: meta.value })
    .from(meta)
    .where(inArray(meta.key, ["data_version", "last_rated_at"]));
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const dataVersion = byKey.get("data_version");
  const lastRatedAt = byKey.get("last_rated_at");
  return {
    dataVersion: dataVersion === undefined ? null : Number(dataVersion),
    lastRatedAt: lastRatedAt === undefined ? null : new Date(lastRatedAt),
  };
}

/** Top eligible players by rank (leaderboard_rank_idx). */
export function readLeaderboard(db: Database, limit: number) {
  return db
    .select({
      rank: leaderboard.rank,
      playerId: leaderboard.playerId,
      gamerTag: players.gamerTag,
      prefix: players.prefix,
      countryCode: leaderboard.countryCode,
      conservativeScore: leaderboard.conservativeScore,
      rating: leaderboard.rating,
      rd: leaderboard.rd,
      rankDelta7d: leaderboard.rankDelta7d,
      lastActiveAt: leaderboard.lastActiveAt,
    })
    .from(leaderboard)
    .innerJoin(players, eq(players.id, leaderboard.playerId))
    .where(isNotNull(leaderboard.rank))
    .orderBy(asc(leaderboard.rank))
    .limit(limit);
}

/**
 * Follows merged_into from `id` to the main player. Returns null when the id is
 * unknown or the chain is longer than MAX_MERGE_HOPS (or loops).
 */
export async function resolveMainPlayerId(db: Database, id: number): Promise<number | null> {
  let current = id;
  for (let hop = 0; hop <= MAX_MERGE_HOPS; hop++) {
    const [row] = await db
      .select({ mergedInto: players.mergedInto })
      .from(players)
      .where(eq(players.id, current));
    if (!row) return null;
    if (row.mergedInto === null) return current;
    current = row.mergedInto;
  }
  return null;
}

/** How far a player is from each LEADERBOARD_ELIGIBILITY threshold. */
export function notRankedReason(setsPlayed: number, eventsPlayed: number, rd: number | null) {
  const { minRatedSets, minQualifyingEvents, maxRatingDeviation } = LEADERBOARD_ELIGIBILITY;
  return {
    setsNeeded: Math.max(0, minRatedSets - setsPlayed),
    eventsNeeded: Math.max(0, minQualifyingEvents - eventsPlayed),
    uncertaintyTooHigh: rd === null || rd > maxRatingDeviation,
  } satisfies NotRankedReason;
}

/** A main player with their leaderboard row, 12-month set record, and recent results. */
export async function readPlayer(db: Database, id: number, asOfPeriod: number) {
  const [player] = await db
    .select({
      gamerTag: players.gamerTag,
      prefix: players.prefix,
      countryCode: players.countryCode,
      userSlug: players.userSlug,
      rank: leaderboard.rank,
      eligible: leaderboard.eligible,
      conservativeScore: leaderboard.conservativeScore,
      rating: leaderboard.rating,
      rd: leaderboard.rd,
      setsPlayed: leaderboard.setsPlayed,
      eventsPlayed: leaderboard.eventsPlayed,
    })
    .from(players)
    .leftJoin(leaderboard, eq(leaderboard.playerId, players.id))
    .where(eq(players.id, id));
  if (!player) return null;

  // The ranking's window and rules: non-DQ sets from qualifying events with
  // rating_period in (asOfPeriod - 52, asOfPeriod]. Uses the winner/loser indexes.
  const firstPeriod = asOfPeriod - LEADERBOARD_ELIGIBILITY.trailingWeeks + 1;
  const [record] = await db
    .select({
      wins: sql<number>`count(*) filter (where ${eq(sets.winnerId, id)})`.mapWith(Number),
      losses: sql<number>`count(*) filter (where ${eq(sets.loserId, id)})`.mapWith(Number),
    })
    .from(sets)
    .innerJoin(events, and(eq(events.id, sets.eventId), eq(events.qualifies, true)))
    .where(
      and(
        sql`(${eq(sets.winnerId, id)} or ${eq(sets.loserId, id)})`,
        eq(sets.isDq, false),
        gte(sets.ratingPeriod, firstPeriod),
        lte(sets.ratingPeriod, asOfPeriod),
      ),
    );

  const eventDate = sql<Date | null>`coalesce(${events.startAt}, ${tournaments.startAt})`;
  // Uses standings_player_id_idx.
  const recentResults = await db
    .select({
      eventId: events.id,
      eventName: events.name,
      tournamentName: tournaments.name,
      date: eventDate.mapWith(events.startAt),
      placement: standings.placement,
      entrants: events.numEntrants,
    })
    .from(standings)
    .innerJoin(events, eq(events.id, standings.eventId))
    .innerJoin(tournaments, eq(tournaments.id, events.tournamentId))
    .where(eq(standings.playerId, id))
    .orderBy(sql`${eventDate} desc nulls last`, desc(events.id))
    .limit(PLAYER_RECENT_RESULTS);

  return { player, record: record ?? { wins: 0, losses: 0 }, recentResults };
}

/** Escapes LIKE wildcards so `%`, `_` and `\` in a search match themselves. */
export const escapeLikePattern = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * Case-insensitive "contains" match on the tag (a prefix match is a special case).
 * A sequential scan for now; a pg_trgm index is a follow-up if the table grows.
 */
export function searchPlayers(db: Database, query: string) {
  const pattern = `%${escapeLikePattern(query)}%`;
  return db
    .select({
      playerId: players.id,
      gamerTag: players.gamerTag,
      prefix: players.prefix,
      rank: leaderboard.rank,
    })
    .from(players)
    .leftJoin(leaderboard, eq(leaderboard.playerId, players.id))
    .where(and(isNull(players.mergedInto), sql`${ilike(players.gamerTag, pattern)} escape ${"\\"}`))
    .orderBy(asc(leaderboard.rank), sql`lower(${players.gamerTag})`, asc(players.id))
    .limit(SEARCH_MAX_RESULTS);
}
