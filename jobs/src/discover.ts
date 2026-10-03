import { sql } from "drizzle-orm";
import { classifyEvent, ULTIMATE_VIDEOGAME_ID, type EventClass } from "@sr/core";
import { events, tournaments, type Database } from "@sr/db";
import type { EventNode, TournamentNode } from "@sr/startgg";
import { isMain, runJob, type JobContext, type JobResult } from "./harness";

const DAY_MS = 86_400_000;
export const DEFAULT_DAYS_BACK = 14;
export const DEFAULT_DAYS_AHEAD = 30;

const toDate = (seconds: number | null) => (seconds === null ? null : new Date(seconds * 1000));
const epochSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

export function classify(event: EventNode, tournament: TournamentNode): EventClass {
  // Rows without a name or slug cannot be stored (the columns are required).
  if (!event.slug || !event.name || !tournament.slug || !tournament.name) return "skip";
  return classifyEvent({
    videogameId: event.videogame?.id ?? null,
    numEntrants: event.numEntrants,
    type: event.type,
    teamRosterSize: event.teamRosterSize,
    isOnline: event.isOnline,
    tournamentIsOnline: tournament.isOnline,
  });
}

/**
 * Upsert by start.gg id. On conflict only the descriptive columns are
 * refreshed: `sync_status` and `sync_cursor` are never touched, so a rerun
 * cannot undo the sync job's progress.
 */
async function upsertPage(
  db: Database,
  rows: { tournament: TournamentNode; event: EventNode; qualifies: boolean }[],
  syncedAt: Date,
): Promise<void> {
  const byTournament = new Map<number, TournamentNode>();
  for (const { tournament } of rows) byTournament.set(tournament.id, tournament);
  await db.transaction(async (tx) => {
    await tx
      .insert(tournaments)
      .values(
        [...byTournament.values()].map((t) => ({
          id: t.id,
          slug: t.slug ?? "",
          name: t.name ?? "",
          startAt: toDate(t.startAt),
          endAt: toDate(t.endAt),
          countryCode: t.countryCode,
          region: t.addrState,
          isOnline: t.isOnline ?? false,
          numAttendees: t.numAttendees,
          syncedAt,
        })),
      )
      .onConflictDoUpdate({
        target: tournaments.id,
        set: {
          slug: sql`excluded.slug`,
          name: sql`excluded.name`,
          startAt: sql`excluded.start_at`,
          endAt: sql`excluded.end_at`,
          countryCode: sql`excluded.country_code`,
          region: sql`excluded.region`,
          isOnline: sql`excluded.is_online`,
          numAttendees: sql`excluded.num_attendees`,
          syncedAt: sql`excluded.synced_at`,
        },
      });
    await tx
      .insert(events)
      .values(
        rows.map(({ tournament, event, qualifies }) => ({
          id: event.id,
          tournamentId: tournament.id,
          slug: event.slug ?? "",
          name: event.name ?? "",
          startAt: toDate(event.startAt),
          numEntrants: event.numEntrants,
          isOnline: event.isOnline ?? tournament.isOnline ?? false,
          state: event.state,
          qualifies,
          syncStatus: "pending" as const,
        })),
      )
      .onConflictDoUpdate({
        target: events.id,
        set: {
          tournamentId: sql`excluded.tournament_id`,
          slug: sql`excluded.slug`,
          name: sql`excluded.name`,
          startAt: sql`excluded.start_at`,
          numEntrants: sql`excluded.num_entrants`,
          isOnline: sql`excluded.is_online`,
          state: sql`excluded.state`,
          qualifies: sql`excluded.qualifies`,
        },
      });
  });
}

export async function discover(ctx: JobContext): Promise<JobResult> {
  const { args, client, db, deadline, now } = ctx;
  const from = args.from ?? new Date(now() - DEFAULT_DAYS_BACK * DAY_MS);
  const to = args.to ?? new Date(now() + DEFAULT_DAYS_AHEAD * DAY_MS);
  const counts = { found: 0, qualify: 0, online: 0, skipped: 0 };
  let partial = false;

  for await (const page of client.tournamentsPages({
    afterDate: epochSeconds(from),
    beforeDate: epochSeconds(to),
    videogameId: ULTIMATE_VIDEOGAME_ID,
  })) {
    const keep: { tournament: TournamentNode; event: EventNode; qualifies: boolean }[] = [];
    for (const tournament of page.items) {
      for (const event of tournament.events ?? []) {
        if (!event) continue;
        counts.found++;
        const kind = classify(event, tournament);
        if (kind === "skip") counts.skipped++;
        else {
          if (kind === "qualifies") counts.qualify++;
          else counts.online++;
          keep.push({ tournament, event, qualifies: kind === "qualifies" });
        }
      }
    }
    if (db && keep.length > 0) await upsertPage(db, keep, new Date(now()));
    if (page.nextCursor && deadline.expired()) {
      partial = true;
      break;
    }
  }

  const stored = counts.qualify + counts.online;
  return {
    eventsTouched: db ? stored : 0,
    partial,
    summary:
      `${counts.found} events found, ${counts.qualify} qualify, ${counts.online} online stored, ` +
      `${counts.skipped} skipped${partial ? " (stopped early: time budget)" : ""}`,
  };
}

if (isMain(import.meta.url)) {
  process.exit(await runJob("discover", process.argv.slice(2), discover));
}
