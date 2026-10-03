/* Read queries behind the /v1 endpoints. Each one is backed by an existing index. */
import {
  DASHBOARD_MOVERS_COUNT,
  DASHBOARD_UPSETS_COUNT,
  DASHBOARD_WEEK_EVENTS_MAX,
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
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  lt,
  lte,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import type { DashboardWindow } from "./dashboard";

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

/**
 * Biggest rank moves this week among ranked players: climbers (delta > 0, biggest first)
 * and fallers (delta < 0, biggest drop first). Ties go to the better rank, then the lower id.
 * New players (null delta) are left out. Small scans of the already-small leaderboard table.
 */
export async function readMovers(db: Database) {
  const moverColumns = {
    rank: leaderboard.rank,
    playerId: leaderboard.playerId,
    gamerTag: players.gamerTag,
    prefix: players.prefix,
    rankDelta7d: leaderboard.rankDelta7d,
  };
  const movers = (direction: "up" | "down") =>
    db
      .select(moverColumns)
      .from(leaderboard)
      .innerJoin(players, eq(players.id, leaderboard.playerId))
      .where(
        and(
          isNotNull(leaderboard.rank),
          direction === "up" ? gt(leaderboard.rankDelta7d, 0) : lt(leaderboard.rankDelta7d, 0),
        ),
      )
      .orderBy(
        direction === "up" ? desc(leaderboard.rankDelta7d) : asc(leaderboard.rankDelta7d),
        asc(leaderboard.rank),
        asc(leaderboard.playerId),
      )
      .limit(DASHBOARD_MOVERS_COUNT);
  const [climbers, fallers] = await Promise.all([movers("up"), movers("down")]);
  return { climbers, fallers };
}

/*
 * The dashboard reads below are raw SQL (like the rate job's writes) because they need a
 * recursive CTE and LATERAL lookups. Rows are checked with Zod as they come back. ids come
 * back as text and times as epoch milliseconds, so nothing depends on driver type parsing.
 */

/**
 * Maps every merged alias to its main player (following chains up to MAX_MERGE_HOPS),
 * the same way the rating job counts one person as one player. Only alias rows are
 * walked (players_merged_into_idx), so this stays tiny.
 */
const withMainPlayers = sql.raw(`with recursive alias_chain(id, main_id, hops) as (
    select id, merged_into, 1 from players where merged_into is not null
    union all
    select c.id, p.merged_into, c.hops + 1
    from alias_chain c join players p on p.id = c.main_id
    where p.merged_into is not null and c.hops < ${MAX_MERGE_HOPS}
  ),
  main_players(id, main_id) as (
    select distinct on (id) id, main_id from alias_chain order by id, hops desc
  )`);

const eventStart = sql.raw("coalesce(e.start_at, t.start_at)");
const epochMs = (expression: string) =>
  sql.raw(`(extract(epoch from ${expression}) * 1000)::float8`);
const timestampParam = (date: Date) => sql`${date.toISOString()}::timestamptz`;

const idText = z.string().regex(/^\d+$/);
const count = z.coerce.number().int().nonnegative();

const upsetRowSchema = z.object({
  set_id: idText,
  winner_games: z.number().int().nullable(),
  loser_games: z.number().int().nullable(),
  completed_at_ms: z.number(),
  event_name: z.string(),
  tournament_name: z.string(),
  gap: z.number().positive(),
  winner_id: idText,
  winner_tag: z.string(),
  winner_prefix: z.string().nullable(),
  loser_id: idText,
  loser_tag: z.string(),
  loser_prefix: z.string().nullable(),
});

/**
 * The biggest upsets among this week's sets: non-DQ sets at qualifying events, completed
 * inside the week, where the winner's rating at the start of the week (their latest
 * rating_history row before this period) was lower than the loser's. Players with no
 * earlier rating are skipped. Uses sets_rating_period_idx and the rating_history key.
 */
export async function readUpsets(db: Database, window: DashboardWindow) {
  const { period, weekStart, weekEnd } = window;
  const priorRating = (column: string) =>
    sql.raw(`(select h.rating from rating_history h
      where h.player_id = ws.${column} and h.period < ${period}
      order by h.period desc limit 1)`);
  const rows = await db.execute(sql`${withMainPlayers},
    week_sets as (
      select s.id, s.winner_games, s.loser_games, s.completed_at,
        e.name as event_name, t.name as tournament_name,
        coalesce(mw.main_id, s.winner_id) as winner_id,
        coalesce(ml.main_id, s.loser_id) as loser_id
      from sets s
      join events e on e.id = s.event_id
      join tournaments t on t.id = e.tournament_id
      left join main_players mw on mw.id = s.winner_id
      left join main_players ml on ml.id = s.loser_id
      where s.rating_period = ${period}
        and s.completed_at >= ${timestampParam(weekStart)}
        and s.completed_at < ${timestampParam(weekEnd)}
        and not s.is_dq
        and e.qualifies
    ),
    gaps as (
      select ws.*, ${priorRating("loser_id")} - ${priorRating("winner_id")} as gap
      from week_sets ws
      where ws.winner_id <> ws.loser_id
    )
    select g.id::text as set_id, g.winner_games, g.loser_games,
      ${epochMs("g.completed_at")} as completed_at_ms, g.event_name, g.tournament_name, g.gap,
      g.winner_id::text as winner_id, pw.gamer_tag as winner_tag, pw.prefix as winner_prefix,
      g.loser_id::text as loser_id, pl.gamer_tag as loser_tag, pl.prefix as loser_prefix
    from gaps g
    join players pw on pw.id = g.winner_id
    join players pl on pl.id = g.loser_id
    where g.gap > 0
    order by g.gap desc, g.id asc
    limit ${DASHBOARD_UPSETS_COUNT}`);
  return z.array(upsetRowSchema).parse(rows);
}

const weekEventRowSchema = z.object({
  event_id: idText,
  event_name: z.string(),
  tournament_name: z.string(),
  city: z.string().nullable(),
  start_at_ms: z.number(),
  num_entrants: z.number().int().nullable(),
  slug: z.string(),
  winner_id: idText.nullable(),
  winner_tag: z.string().nullable(),
  winner_prefix: z.string().nullable(),
});

/**
 * Qualifying events (which are, by definition, in the launch region: discover sets
 * `qualifies` only for them) starting this week, by start then id. The winner is the
 * player placed 1st (lowest id on a shared 1st), or null. Uses standings' primary key.
 */
export async function readWeekEvents(db: Database, window: DashboardWindow) {
  const rows = await db.execute(sql`${withMainPlayers}
    select e.id::text as event_id, e.name as event_name, t.name as tournament_name, t.city,
      ${epochMs("coalesce(e.start_at, t.start_at)")} as start_at_ms, e.num_entrants, e.slug,
      p.id::text as winner_id, p.gamer_tag as winner_tag, p.prefix as winner_prefix
    from events e
    join tournaments t on t.id = e.tournament_id
    left join lateral (
      select coalesce(m.main_id, st.player_id) as player_id
      from standings st left join main_players m on m.id = st.player_id
      where st.event_id = e.id and st.placement = 1
      order by st.player_id limit 1
    ) w on true
    left join players p on p.id = w.player_id
    where e.qualifies
      and ${eventStart} >= ${timestampParam(window.weekStart)}
      and ${eventStart} < ${timestampParam(window.weekEnd)}
    order by ${eventStart} asc, e.id asc
    limit ${DASHBOARD_WEEK_EVENTS_MAX}`);
  return z.array(weekEventRowSchema).parse(rows);
}

const yearTotalsRowSchema = z.object({
  event_count: count,
  total_entrants: count,
  unique_players: count,
});
const biggestEventRowSchema = z.object({
  event_id: idText,
  event_name: z.string(),
  tournament_name: z.string(),
  num_entrants: z.number().int().nonnegative(),
  slug: z.string(),
});
const mostWinsRowSchema = z.object({
  player_id: idText,
  gamer_tag: z.string(),
  prefix: z.string().nullable(),
  wins: z.coerce.number().int().positive(),
});

/**
 * "This year" totals over qualifying events that started between January 1 (UTC) and
 * `now`. Upcoming events are left out, because their entrant counts are still growing.
 * Aggregates run in SQL; the per-event joins use sets_event_id_idx and standings' key.
 */
export async function readYear(db: Database, window: DashboardWindow, now: Date) {
  const yearEvents = sql`year_events as (
      select e.id, e.name, t.name as tournament_name, e.num_entrants, e.slug,
        ${eventStart} as start_at
      from events e
      join tournaments t on t.id = e.tournament_id
      where e.qualifies
        and ${eventStart} >= ${timestampParam(window.yearStart)}
        and ${eventStart} <= ${timestampParam(now)}
    )`;
  const [totals, biggest, mostWins] = await Promise.all([
    db.execute(sql`${withMainPlayers}, ${yearEvents}
      select
        (select count(*) from year_events)::int as event_count,
        (select coalesce(sum(num_entrants), 0) from year_events)::int as total_entrants,
        (select count(distinct coalesce(m.main_id, x.player_id))
          from sets s
          join year_events ye on ye.id = s.event_id
          cross join lateral (values (s.winner_id), (s.loser_id)) as x(player_id)
          left join main_players m on m.id = x.player_id
          where not s.is_dq and s.rating_period is not null)::int as unique_players`),
    db.execute(sql`with ${yearEvents}
      select id::text as event_id, name as event_name, tournament_name, num_entrants, slug
      from year_events
      where num_entrants is not null
      order by num_entrants desc, start_at asc, id asc
      limit 1`),
    db.execute(sql`${withMainPlayers}, ${yearEvents},
      firsts as (
        select coalesce(m.main_id, st.player_id) as player_id, count(distinct st.event_id) as wins
        from standings st
        join year_events ye on ye.id = st.event_id
        left join main_players m on m.id = st.player_id
        where st.placement = 1
        group by 1
      )
      select f.player_id::text as player_id, p.gamer_tag, p.prefix, f.wins
      from firsts f join players p on p.id = f.player_id
      order by f.wins desc, f.player_id asc
      limit 1`),
  ]);
  return {
    totals: yearTotalsRowSchema.parse(totals[0]),
    biggestEvent: z.array(biggestEventRowSchema).parse(biggest)[0] ?? null,
    mostWins: z.array(mostWinsRowSchema).parse(mostWins)[0] ?? null,
  };
}
