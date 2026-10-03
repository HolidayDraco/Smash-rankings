import { appendFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { and, between, eq, gte, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { LEADERBOARD_ELIGIBILITY } from "@sr/core";
import { events, leaderboard, meta, players, sets, standings, type Database } from "@sr/db";
import {
  buildLeaderboard,
  eligibilityStats,
  periodIndexFor,
  periodIndexToIsoWeek,
  periodStart,
  rateHistory,
  ratingWindow,
  resolveAlias,
  type LeaderboardRow,
  type PeriodSet,
  type StandingsEvent,
} from "@sr/ranking";
import { isMain, runDbJob, type DbJobContext, type JobResult } from "./harness";

/** Rows per INSERT … jsonb_to_recordset statement, to keep each parameter a few MB at most. */
const CHUNK_ROWS = 10_000;

/**
 * `meta.previous_ranks`: the ranked list as it stood at the end of `period`,
 * captured by the first run of the following week. Source of rank_delta_7d.
 */
const previousRanksSchema = z.object({
  period: z.number().int(),
  ranks: z.record(z.string(), z.number().int().positive()),
});
type PreviousRanks = z.infer<typeof previousRanksSchema>;

export interface RateHooks {
  /** Test hook: runs inside the write transaction, after the rebuild and before commit. */
  beforeCommit?: () => Promise<void>;
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Reads go through the harness's SELECT-only handle. */
type ReadDb = Pick<Database, "select">;

async function readMeta(db: ReadDb): Promise<Map<string, string>> {
  const keys = ["ranks_period", "previous_ranks"];
  const rows = await db.select().from(meta).where(inArray(meta.key, keys));
  return new Map(rows.map((row) => [row.key, row.value]));
}

async function upsertMeta(tx: Tx, key: string, value: string, update: SQL = sql`excluded.value`) {
  return tx
    .insert(meta)
    .values({ key, value })
    .onConflictDoUpdate({ target: meta.key, set: { value: update } })
    .returning({ value: meta.value });
}

/** Insert `rows` as JSON through jsonb_to_recordset, in chunks. `statement` gets the JSON param. */
async function insertJson<T>(tx: Tx, rows: readonly T[], statement: (json: string) => SQL) {
  for (let start = 0; start < rows.length; start += CHUNK_ROWS) {
    await tx.execute(statement(JSON.stringify(rows.slice(start, start + CHUNK_ROWS))));
  }
}

/** Week-over-week snapshot logic for decision 3 (see METHODOLOGY "Rank change over 7 days"). */
async function previousRanksFor(db: ReadDb, asOfPeriod: number) {
  const stored = await readMeta(db);
  const ranksPeriod = stored.has("ranks_period") ? Number(stored.get("ranks_period")) : null;
  const raw = stored.get("previous_ranks");
  let snapshot: PreviousRanks | null = raw ? previousRanksSchema.parse(JSON.parse(raw)) : null;
  let newSnapshot: PreviousRanks | null = null;
  if (ranksPeriod !== null && asOfPeriod > ranksPeriod) {
    // First run of a new week: the current leaderboard holds last week's final ranks.
    const current = await db
      .select({ playerId: leaderboard.playerId, rank: leaderboard.rank })
      .from(leaderboard)
      .where(isNotNull(leaderboard.rank));
    const ranks: Record<string, number> = {};
    for (const row of current) if (row.rank !== null) ranks[String(row.playerId)] = row.rank;
    snapshot = newSnapshot = { period: ranksPeriod, ranks };
  }
  // Only a snapshot from exactly one week earlier counts as "7 days ago".
  const usable = snapshot && snapshot.period === asOfPeriod - 1 ? snapshot : null;
  const previousRanks = usable ? new Map(Object.entries(usable.ranks)) : undefined;
  return { previousRanks, newSnapshot };
}

const fmt = (value: number) => String(Math.round(value));
const cell = (text: string) => text.replace(/\|/g, "\\|");

async function top20Table(db: ReadDb, rows: readonly LeaderboardRow[]): Promise<string> {
  const top = rows.filter((row) => row.rank !== null).slice(0, 20);
  const ids = top.map((row) => Number(row.playerId));
  const tags = new Map<string, string>();
  if (ids.length > 0) {
    const found = await db
      .select({ id: players.id, gamerTag: players.gamerTag })
      .from(players)
      .where(inArray(players.id, ids));
    for (const { id, gamerTag } of found) tags.set(String(id), gamerTag);
  }
  const lines = [
    "| Rank | Player | Score | Rating | RD | Sets | Events | 7-day change |",
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...top.map((row) => {
      const delta =
        row.rankDelta7d === null
          ? "new"
          : row.rankDelta7d > 0
            ? `+${row.rankDelta7d}`
            : String(row.rankDelta7d);
      const tag = cell(tags.get(row.playerId) ?? row.playerId);
      return `| ${row.rank} | ${tag} | ${fmt(row.conservativeScore)} | ${fmt(row.rating)} | ${fmt(row.ratingDeviation)} | ${row.ratedSets} | ${row.qualifyingEvents} | ${delta} |`;
    }),
  ];
  return top.length > 0 ? lines.join("\n") : "_No player meets the ranking rules yet._";
}

export function rateJob(hooks: RateHooks = {}) {
  return async function rate(ctx: DbJobContext): Promise<JobResult> {
    const started = performance.now();
    const { readDb, db, out } = ctx;
    const asOfPeriod = periodIndexFor(ctx.args.asOf ?? new Date(ctx.now()));
    const trailingWeeks = LEADERBOARD_ELIGIBILITY.trailingWeeks;
    const { fromPeriod, toPeriod } = ratingWindow(asOfPeriod, trailingWeeks);

    // 1. Read: aliases, qualifying sets in the window, and qualifying standings.
    const aliasRows = await readDb
      .select({ id: players.id, mergedInto: players.mergedInto })
      .from(players)
      .where(isNotNull(players.mergedInto));
    const aliases = new Map(aliasRows.map((row) => [String(row.id), String(row.mergedInto)]));
    const setRows = await readDb
      .select({
        winnerId: sets.winnerId,
        loserId: sets.loserId,
        eventId: sets.eventId,
        isDq: sets.isDq,
        period: sets.ratingPeriod,
        completedAt: sets.completedAt,
      })
      .from(sets)
      .innerJoin(events, eq(events.id, sets.eventId))
      .where(
        and(
          eq(events.qualifies, true),
          or(isNull(sets.ratingPeriod), between(sets.ratingPeriod, fromPeriod, toPeriod)),
        ),
      )
      .orderBy(sets.id);
    const standingRows = await readDb
      .select({ playerId: standings.playerId, eventId: standings.eventId, startAt: events.startAt })
      .from(standings)
      .innerJoin(events, eq(events.id, standings.eventId))
      .where(
        and(
          eq(events.qualifies, true),
          or(isNull(events.startAt), gte(events.startAt, periodStart(fromPeriod))),
        ),
      )
      .orderBy(standings.eventId, standings.playerId);

    // 2. Compute with the pure engine.
    let missingPeriod = 0;
    let dqs = 0;
    const periodSets: PeriodSet[] = [];
    const eventPeriod = new Map<string, number>();
    const lastActiveAt = new Map<string, Date>();
    for (const row of setRows) {
      if (row.period === null) {
        missingPeriod += 1;
        continue;
      }
      const eventId = String(row.eventId);
      eventPeriod.set(eventId, Math.max(eventPeriod.get(eventId) ?? row.period, row.period));
      periodSets.push({
        winnerId: String(row.winnerId),
        loserId: String(row.loserId),
        eventId,
        period: row.period,
        isDq: row.isDq,
      });
      if (row.isDq) {
        dqs += 1;
        continue;
      }
      // last_active_at: latest rated (non-DQ, non-self) set per main player.
      const winner = resolveAlias(String(row.winnerId), aliases);
      const loser = resolveAlias(String(row.loserId), aliases);
      if (!row.completedAt || winner === loser) continue;
      for (const id of [winner, loser]) {
        const previous = lastActiveAt.get(id);
        if (!previous || row.completedAt > previous) lastActiveAt.set(id, row.completedAt);
      }
    }
    const standingsEvents: StandingsEvent[] = [];
    for (const row of standingRows) {
      const eventId = String(row.eventId);
      // The event's week: its start date, or (no start date) the week of its last set.
      const period = row.startAt ? periodIndexFor(row.startAt) : eventPeriod.get(eventId);
      if (period !== undefined)
        standingsEvents.push({ playerId: String(row.playerId), eventId, period });
    }

    const { ratings, history } = rateHistory({
      sets: periodSets,
      fromPeriod,
      toPeriod,
      aliases,
      historyRows: "active-weeks",
    });
    const stats = eligibilityStats({
      sets: periodSets,
      standingsEvents,
      asOfPeriod,
      trailingWeeks,
      aliases,
    });
    const { previousRanks, newSnapshot } = await previousRanksFor(readDb, asOfPeriod);
    const rows = buildLeaderboard({ ratings, stats, previousRanks });
    const ranked = rows.filter((row) => row.rank !== null).length;
    const ratedEvents = new Set(periodSets.filter((set) => !set.isDq).map((set) => set.eventId));

    // 3. Write everything in one transaction: readers see the old or the new data, never a mix.
    let dataVersion = "unchanged (dry run)";
    let historyNote = `${history.length} history rows (not written)`;
    if (db) {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`create temp table rating_history_new (like rating_history including indexes) on commit drop`,
        );
        await insertJson(
          tx,
          history.map((row) => ({
            player_id: Number(row.playerId),
            period: row.period,
            rating: row.rating,
            rd: row.ratingDeviation,
            volatility: row.volatility,
            sets_played: row.setsPlayed,
          })),
          (json) => sql`
            insert into rating_history_new (player_id, period, rating, rd, volatility, sets_played)
            select * from jsonb_to_recordset(${json}::jsonb) as r(player_id bigint, period integer,
              rating double precision, rd double precision, volatility double precision, sets_played integer)`,
        );
        // Upsert, skipping rows whose values did not change, then drop every row that is no
        // longer produced: idle weeks, weeks before the window, merged aliases.
        const upserted = await tx.execute(sql`
          insert into rating_history (player_id, period, rating, rd, volatility, sets_played)
          select player_id, period, rating, rd, volatility, sets_played from rating_history_new
          on conflict (player_id, period) do update set rating = excluded.rating, rd = excluded.rd,
            volatility = excluded.volatility, sets_played = excluded.sets_played
          where (rating_history.rating, rating_history.rd, rating_history.volatility, rating_history.sets_played)
            is distinct from (excluded.rating, excluded.rd, excluded.volatility, excluded.sets_played)`);
        const deleted = await tx.execute(sql`
          delete from rating_history h where not exists (
            select 1 from rating_history_new n where n.player_id = h.player_id and n.period = h.period)`);
        historyNote = `${history.length} history rows (${upserted.count} written, ${deleted.count} removed)`;

        // DELETE (not TRUNCATE) keeps the rebuild invisible to readers until commit.
        await tx.delete(leaderboard);
        await insertJson(
          tx,
          rows.map((row) => ({
            player_id: Number(row.playerId),
            rank: row.rank,
            conservative_score: row.conservativeScore,
            rating: row.rating,
            rd: row.ratingDeviation,
            rank_delta_7d: row.rankDelta7d,
            last_active_at: lastActiveAt.get(row.playerId)?.toISOString() ?? null,
            eligible: row.eligible,
            sets_played: row.ratedSets,
            events_played: row.qualifyingEvents,
          })),
          (json) => sql`
            insert into leaderboard (player_id, rank, conservative_score, rating, rd, rank_delta_7d,
              last_active_at, eligible, region, country_code, sets_played, events_played)
            select r.player_id, r.rank, r.conservative_score, r.rating, r.rd, r.rank_delta_7d,
              r.last_active_at, r.eligible, p.region, p.country_code, r.sets_played, r.events_played
            from jsonb_to_recordset(${json}::jsonb) as r(player_id bigint, rank integer,
              conservative_score double precision, rating double precision, rd double precision,
              rank_delta_7d integer, last_active_at timestamptz, eligible boolean,
              sets_played integer, events_played integer)
            join players p on p.id = r.player_id`,
        );

        if (newSnapshot) await upsertMeta(tx, "previous_ranks", JSON.stringify(newSnapshot));
        await upsertMeta(tx, "ranks_period", String(asOfPeriod));
        await upsertMeta(tx, "last_rated_at", new Date(ctx.now()).toISOString());
        const [version] = await upsertMeta(
          tx,
          "data_version",
          "1",
          sql`(${meta.value}::bigint + 1)::text`,
        );
        dataVersion = version?.value ?? "?";
        await hooks.beforeCommit?.();
      });
    }

    const table = await top20Table(readDb, rows);
    const week = periodIndexToIsoWeek(asOfPeriod);
    out(`Top 20, week ${week}:\n${table}`);
    const summaryFile = ctx.env.GITHUB_STEP_SUMMARY;
    if (summaryFile) appendFileSync(summaryFile, `### Top 20 (week ${week})\n\n${table}\n\n`);

    ctx.progress.eventsTouched = ratedEvents.size;
    const seconds = ((performance.now() - started) / 1000).toFixed(2);
    return {
      eventsTouched: ratedEvents.size,
      summary:
        `week ${week}: ${ratings.size} players rated from ${periodSets.length - dqs} non-DQ sets ` +
        `(${dqs} DQs skipped, ${missingPeriod} without a week skipped), ${ranked} ranked; ` +
        `${historyNote}; data_version ${dataVersion}; runtime ${seconds} s`,
    };
  };
}

if (isMain(import.meta.url)) {
  process.exit(await runDbJob("rate", process.argv.slice(2), rateJob()));
}
