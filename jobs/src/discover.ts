import { and, eq, inArray, ne, sql } from "drizzle-orm";
import {
  classifyEvent,
  isInLaunchRegion,
  isOnlineEvent,
  ULTIMATE_VIDEOGAME_ID,
  type EventClass,
} from "@sr/core";
import { events, tournaments, type Database } from "@sr/db";
import type { Cursor, EventNode, TournamentNode } from "@sr/startgg";
import { isMain, runJob, type JobContext, type JobResult } from "./harness";

export const DAY_MS = 86_400_000;
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
    tournamentCountryCode: tournament.countryCode,
    tournamentAddrState: tournament.addrState,
  });
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Slugs are unique, but a recreated tournament or event arrives with a new id and
 * the old slug. Rather than fail forever (or delete anything), the old row keeps
 * its data and gets its slug renamed to `<slug>~stale-<oldId>`. That name is unique
 * per id, so it can never clash again, and the rerun is a no-op.
 */
async function freeSlugs(
  tx: Tx,
  table: typeof tournaments | typeof events,
  incoming: { id: number; slug: string }[],
): Promise<void> {
  const holders = await tx
    .select({ id: table.id, slug: table.slug })
    .from(table)
    .where(inArray(table.slug, [...new Set(incoming.map((r) => r.slug))]));
  for (const holder of holders) {
    const wanted = incoming.find((r) => r.slug === holder.slug);
    if (!wanted || wanted.id === holder.id) continue;
    await tx
      .update(table)
      .set({ slug: `${holder.slug}~stale-${holder.id}` })
      .where(and(eq(table.id, holder.id), ne(table.id, wanted.id)));
  }
}

/**
 * Events we already store that now classify as "skip" (entrants dropped, became
 * doubles, moved out of the launch region, ...) must stop qualifying. Only existing rows are touched; none are inserted.
 */
async function demoteSkipped(db: Database, skipped: EventNode[]): Promise<number> {
  const existing = await db
    .select({ id: events.id })
    .from(events)
    .where(
      inArray(
        events.id,
        skipped.map((e) => e.id),
      ),
    );
  const ids = new Set(existing.map((r) => r.id));
  for (const event of skipped) {
    if (!ids.has(event.id)) continue;
    await db
      .update(events)
      .set({ qualifies: false, numEntrants: event.numEntrants })
      .where(eq(events.id, event.id));
  }
  return ids.size;
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
    await freeSlugs(
      tx,
      tournaments,
      [...byTournament.values()].map((t) => ({ id: t.id, slug: t.slug ?? "" })),
    );
    await freeSlugs(
      tx,
      events,
      rows.map(({ event }) => ({ id: event.id, slug: event.slug ?? "" })),
    );
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
          city: t.city,
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
          city: sql`excluded.city`,
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
          isOnline: isOnlineEvent({
            isOnline: event.isOnline,
            tournamentIsOnline: tournament.isOnline,
          }),
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

export function discover(ctx: JobContext): Promise<JobResult> {
  const { args, now } = ctx;
  return discoverWindow(
    ctx,
    args.from ?? new Date(now() - DEFAULT_DAYS_BACK * DAY_MS),
    args.to ?? new Date(now() + DEFAULT_DAYS_AHEAD * DAY_MS),
  );
}

/** Discover over an explicit window (the backfill job calls this once per month). */
export async function discoverWindow(
  ctx: JobContext,
  from: Date,
  to: Date,
  opts: {
    /** Stop paging once this many requests were used; the result is partial and carries `resume`. */
    maxRequests?: number;
    /** Continue a window from a saved page. */
    cursor?: Cursor;
    /** Called after each page is stored, with the cursor to continue from (so a crash loses at most one page). */
    onPage?: (next: Cursor) => Promise<void>;
  } = {},
): Promise<JobResult & { resume: Cursor | null }> {
  const { client, db, deadline, now, progress } = ctx;
  const requestsBefore = client.requestsUsed;
  let resume: Cursor | null = null;
  // outOfRegion is part of skipped, counted apart so a run that finds no Texas events is visible.
  const counts = { found: 0, qualify: 0, online: 0, skipped: 0, outOfRegion: 0 };
  let partial = false;

  for await (const page of client.tournamentsPages({
    afterDate: epochSeconds(from),
    beforeDate: epochSeconds(to),
    videogameId: ULTIMATE_VIDEOGAME_ID,
    ...(opts.cursor ? { cursor: opts.cursor } : {}),
  })) {
    const skippedEvents: EventNode[] = [];
    const keep: { tournament: TournamentNode; event: EventNode; qualifies: boolean }[] = [];
    for (const tournament of page.items) {
      const inRegion = isInLaunchRegion(tournament);
      for (const event of tournament.events ?? []) {
        if (!event) continue;
        counts.found++;
        const kind = classify(event, tournament);
        if (kind === "skip") {
          counts.skipped++;
          if (!inRegion) counts.outOfRegion++;
          skippedEvents.push(event);
        } else {
          if (kind === "qualifies") counts.qualify++;
          else counts.online++;
          keep.push({ tournament, event, qualifies: kind === "qualifies" });
        }
      }
    }
    if (db && keep.length > 0) {
      await upsertPage(db, keep, new Date(now()));
      progress.eventsTouched += keep.length;
    }
    if (db && skippedEvents.length > 0)
      progress.eventsTouched += await demoteSkipped(db, skippedEvents);
    if (page.nextCursor) await opts.onPage?.(page.nextCursor);
    const overBudget =
      opts.maxRequests !== undefined && client.requestsUsed - requestsBefore >= opts.maxRequests;
    if (page.nextCursor && (deadline.expired() || overBudget)) {
      partial = true;
      resume = page.nextCursor;
      break;
    }
  }

  return {
    resume,
    eventsTouched: progress.eventsTouched,
    partial,
    summary:
      `${counts.found} events found, ${counts.qualify} qualify, ${counts.online} online stored, ` +
      `${counts.skipped} skipped (${counts.outOfRegion} outside the launch region)` +
      `${partial ? " (stopped early: time budget)" : ""}`,
  };
}

if (isMain(import.meta.url)) {
  process.exit(await runJob("discover", process.argv.slice(2), discover));
}
