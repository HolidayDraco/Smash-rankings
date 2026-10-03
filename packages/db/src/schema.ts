/**
 * Database schema (blueprint §3.3). Store only what we display or need for
 * ranking: start.gg ToS "minimum data".
 *
 * Conventions:
 * - start.gg ids are stored as bigint in "number" mode. They fit in a JS number
 *   (< 2^53) but may outgrow Postgres `integer` (2^31).
 * - Every timestamp is `timestamptz`.
 * - Column names are written out in snake_case, so no casing option is needed
 *   in the client or drizzle-kit config.
 * - A "rating period" is an integer week index; the ranking package defines
 *   how a completion time maps to a period.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const startggId = (name: string) => bigint(name, { mode: "number" });
const timestampTz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const syncStatus = pgEnum("sync_status", ["pending", "partial", "done", "error"]);
export const ingestJob = pgEnum("ingest_job", ["discover", "sync", "backfill", "rate"]);
export const ingestStatus = pgEnum("ingest_status", ["running", "success", "partial", "error"]);

export const tournaments = pgTable("tournaments", {
  id: startggId("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  startAt: timestampTz("start_at"),
  endAt: timestampTz("end_at"),
  countryCode: text("country_code"),
  region: text("region"),
  isOnline: boolean("is_online").notNull().default(false),
  numAttendees: integer("num_attendees"),
  syncedAt: timestampTz("synced_at"),
});

export const events = pgTable(
  "events",
  {
    id: startggId("id").primaryKey(),
    tournamentId: startggId("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    startAt: timestampTz("start_at"),
    numEntrants: integer("num_entrants"),
    isOnline: boolean("is_online").notNull().default(false),
    /** start.gg ActivityState, e.g. CREATED / ACTIVE / COMPLETED. */
    state: text("state"),
    qualifies: boolean("qualifies").notNull().default(false),
    /** Our own rough tier label. Not an official UltRank tier. */
    approxTier: text("approx_tier"),
    syncStatus: syncStatus("sync_status").notNull().default("pending"),
    /** Page checkpoint so an interrupted sync can resume. */
    syncCursor: text("sync_cursor"),
    lastSyncedAt: timestampTz("last_synced_at"),
  },
  (table) => [
    index("events_tournament_id_idx").on(table.tournamentId),
    index("events_sync_queue_idx").on(table.qualifies, table.syncStatus),
  ],
);

export const players = pgTable(
  "players",
  {
    id: startggId("id").primaryKey(),
    gamerTag: text("gamer_tag").notNull(),
    prefix: text("prefix"),
    countryCode: text("country_code"),
    region: text("region"),
    userSlug: text("user_slug"),
    /** Set when this player is a manual alias of another player. */
    mergedInto: startggId("merged_into").references((): AnyPgColumn => players.id, {
      onDelete: "set null",
    }),
  },
  (table) => [index("players_merged_into_idx").on(table.mergedInto)],
);

export const sets = pgTable(
  "sets",
  {
    id: startggId("id").primaryKey(),
    eventId: startggId("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    winnerId: startggId("winner_id")
      .notNull()
      .references(() => players.id),
    loserId: startggId("loser_id")
      .notNull()
      .references(() => players.id),
    /** DQ sets: is_dq = true and games stored as null (start.gg reports a DQ as -1). */
    winnerGames: integer("winner_games"),
    loserGames: integer("loser_games"),
    isDq: boolean("is_dq").notNull().default(false),
    roundLabel: text("round_label"),
    completedAt: timestampTz("completed_at"),
    ratingPeriod: integer("rating_period"),
  },
  (table) => [
    index("sets_winner_id_idx").on(table.winnerId),
    index("sets_loser_id_idx").on(table.loserId),
    index("sets_event_id_idx").on(table.eventId),
    index("sets_rating_period_idx").on(table.ratingPeriod),
    check("sets_distinct_players", sql`${table.winnerId} <> ${table.loserId}`),
    check(
      "sets_games_non_negative",
      sql`coalesce(${table.winnerGames}, 0) >= 0 and coalesce(${table.loserGames}, 0) >= 0`,
    ),
  ],
);

export const standings = pgTable(
  "standings",
  {
    eventId: startggId("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    playerId: startggId("player_id")
      .notNull()
      .references(() => players.id),
    placement: integer("placement").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.playerId] }),
    index("standings_player_id_idx").on(table.playerId),
  ],
);

export const ratingHistory = pgTable(
  "rating_history",
  {
    playerId: startggId("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    period: integer("period").notNull(),
    rating: doublePrecision("rating").notNull(),
    rd: doublePrecision("rd").notNull(),
    volatility: doublePrecision("volatility").notNull(),
    setsPlayed: integer("sets_played").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.playerId, table.period] })],
);

/**
 * Rebuilt by each rate run inside one transaction (delete + insert), which
 * Postgres makes atomic for readers. Use DELETE, never TRUNCATE: TRUNCATE is
 * not MVCC-safe and blocks readers.
 */
export const leaderboard = pgTable(
  "leaderboard",
  {
    playerId: startggId("player_id")
      .primaryKey()
      .references(() => players.id, { onDelete: "cascade" }),
    /** Null when the player is not eligible to be ranked. */
    rank: integer("rank"),
    conservativeScore: doublePrecision("conservative_score").notNull(),
    rating: doublePrecision("rating").notNull(),
    rd: doublePrecision("rd").notNull(),
    rankDelta7d: integer("rank_delta_7d"),
    lastActiveAt: timestampTz("last_active_at"),
    eligible: boolean("eligible").notNull(),
    region: text("region"),
    countryCode: text("country_code"),
    setsPlayed: integer("sets_played").notNull().default(0),
    eventsPlayed: integer("events_played").notNull().default(0),
  },
  (table) => [
    index("leaderboard_rank_idx").on(table.rank),
    index("leaderboard_country_rank_idx").on(table.countryCode, table.rank),
  ],
);

export const ingestRuns = pgTable(
  "ingest_runs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    job: ingestJob("job").notNull(),
    startedAt: timestampTz("started_at").notNull().defaultNow(),
    finishedAt: timestampTz("finished_at"),
    status: ingestStatus("status").notNull().default("running"),
    requestsUsed: integer("requests_used").notNull().default(0),
    eventsTouched: integer("events_touched").notNull().default(0),
    /** Short error summary. Never put tokens or URLs with credentials here. */
    error: text("error"),
  },
  (table) => [index("ingest_runs_job_started_at_idx").on(table.job, table.startedAt)],
);

/** Small key/value store, e.g. `data_version`, `last_rated_at`. */
export const meta = pgTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
