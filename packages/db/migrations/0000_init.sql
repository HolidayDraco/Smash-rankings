CREATE TYPE "public"."ingest_job" AS ENUM('discover', 'sync', 'backfill', 'rate');--> statement-breakpoint
CREATE TYPE "public"."ingest_status" AS ENUM('running', 'success', 'partial', 'error');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('pending', 'partial', 'done', 'error');--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigint PRIMARY KEY NOT NULL,
	"tournament_id" bigint NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"start_at" timestamp with time zone,
	"num_entrants" integer,
	"is_online" boolean DEFAULT false NOT NULL,
	"state" text,
	"qualifies" boolean DEFAULT false NOT NULL,
	"approx_tier" text,
	"sync_status" "sync_status" DEFAULT 'pending' NOT NULL,
	"sync_cursor" text,
	"last_synced_at" timestamp with time zone,
	CONSTRAINT "events_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ingest_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job" "ingest_job" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "ingest_status" DEFAULT 'running' NOT NULL,
	"requests_used" integer DEFAULT 0 NOT NULL,
	"events_touched" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "leaderboard" (
	"player_id" bigint PRIMARY KEY NOT NULL,
	"rank" integer,
	"conservative_score" double precision NOT NULL,
	"rating" double precision NOT NULL,
	"rd" double precision NOT NULL,
	"rank_delta_7d" integer,
	"last_active_at" timestamp with time zone,
	"eligible" boolean NOT NULL,
	"region" text,
	"country_code" text,
	"sets_played" integer DEFAULT 0 NOT NULL,
	"events_played" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" bigint PRIMARY KEY NOT NULL,
	"gamer_tag" text NOT NULL,
	"prefix" text,
	"country_code" text,
	"region" text,
	"user_slug" text,
	"merged_into" bigint
);
--> statement-breakpoint
CREATE TABLE "rating_history" (
	"player_id" bigint NOT NULL,
	"period" integer NOT NULL,
	"rating" double precision NOT NULL,
	"rd" double precision NOT NULL,
	"volatility" double precision NOT NULL,
	"sets_played" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rating_history_player_id_period_pk" PRIMARY KEY("player_id","period")
);
--> statement-breakpoint
CREATE TABLE "sets" (
	"id" bigint PRIMARY KEY NOT NULL,
	"event_id" bigint NOT NULL,
	"winner_id" bigint NOT NULL,
	"loser_id" bigint NOT NULL,
	"winner_games" integer,
	"loser_games" integer,
	"is_dq" boolean DEFAULT false NOT NULL,
	"round_label" text,
	"completed_at" timestamp with time zone,
	"rating_period" integer,
	CONSTRAINT "sets_distinct_players" CHECK ("sets"."winner_id" <> "sets"."loser_id"),
	CONSTRAINT "sets_games_non_negative" CHECK (coalesce("sets"."winner_games", 0) >= 0 and coalesce("sets"."loser_games", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "standings" (
	"event_id" bigint NOT NULL,
	"player_id" bigint NOT NULL,
	"placement" integer NOT NULL,
	CONSTRAINT "standings_event_id_player_id_pk" PRIMARY KEY("event_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" bigint PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"country_code" text,
	"region" text,
	"is_online" boolean DEFAULT false NOT NULL,
	"num_attendees" integer,
	"synced_at" timestamp with time zone,
	CONSTRAINT "tournaments_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard" ADD CONSTRAINT "leaderboard_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_merged_into_players_id_fk" FOREIGN KEY ("merged_into") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_winner_id_players_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_loser_id_players_id_fk" FOREIGN KEY ("loser_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standings" ADD CONSTRAINT "standings_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standings" ADD CONSTRAINT "standings_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_tournament_id_idx" ON "events" USING btree ("tournament_id");--> statement-breakpoint
CREATE INDEX "events_sync_queue_idx" ON "events" USING btree ("qualifies","sync_status");--> statement-breakpoint
CREATE INDEX "ingest_runs_job_started_at_idx" ON "ingest_runs" USING btree ("job","started_at");--> statement-breakpoint
CREATE INDEX "leaderboard_rank_idx" ON "leaderboard" USING btree ("rank");--> statement-breakpoint
CREATE INDEX "leaderboard_country_rank_idx" ON "leaderboard" USING btree ("country_code","rank");--> statement-breakpoint
CREATE INDEX "sets_winner_id_idx" ON "sets" USING btree ("winner_id");--> statement-breakpoint
CREATE INDEX "sets_loser_id_idx" ON "sets" USING btree ("loser_id");--> statement-breakpoint
CREATE INDEX "sets_event_id_idx" ON "sets" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "sets_rating_period_idx" ON "sets" USING btree ("rating_period");--> statement-breakpoint
CREATE INDEX "standings_player_id_idx" ON "standings" USING btree ("player_id");