import { and, asc, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { periodIndexFor } from "@sr/core";
import { events, players, sets, standings, type Database } from "@sr/db";
import {
  StartggAuthError,
  type Cursor,
  type NormalizedPlayer,
  type NormalizedSet,
} from "@sr/startgg";
import {
  isMain,
  redactError,
  runJob,
  UsageError,
  type JobContext,
  type JobResult,
} from "./harness";

const HOUR_MS = 3_600_000;
/** Events handled per run; the rest wait for the next run (oldest first). */
export const MAX_EVENTS_PER_RUN = 25;
/** A finished event is fetched once more this long after its last sync (bracket corrections)... */
export const RESYNC_AFTER_MS = 48 * HOUR_MS;
/** ...but only if that last sync happened within this long after the event started. */
export const RESYNC_WINDOW_MS = 72 * HOUR_MS;

export interface SyncCandidate {
  id: number;
  syncCursor: string | null;
}

/**
 * Which events to sync: qualifying events that have started and are
 * pending / partial / error, plus `done` events due their one re-sync
 * (last_synced_at < start_at + 72 h and now > last_synced_at + 48 h).
 * Never selects qualifies = false events. Oldest first, capped.
 */
export async function selectEvents(
  db: Database,
  now: Date,
  limit = MAX_EVENTS_PER_RUN,
): Promise<SyncCandidate[]> {
  const resyncDue = and(
    eq(events.syncStatus, "done"),
    isNotNull(events.lastSyncedAt),
    sql`${events.lastSyncedAt} < ${events.startAt} + ${RESYNC_WINDOW_MS / 1000} * interval '1 second'`,
    lt(events.lastSyncedAt, new Date(now.getTime() - RESYNC_AFTER_MS)),
  );
  return db
    .select({ id: events.id, syncCursor: events.syncCursor })
    .from(events)
    .where(
      and(
        eq(events.qualifies, true),
        lt(events.startAt, now),
        or(inArray(events.syncStatus, ["pending", "partial", "error"]), resyncDue),
      ),
    )
    .orderBy(asc(events.startAt), asc(events.id))
    .limit(limit);
}

export function parseCursor(text: string | null): Cursor | undefined {
  if (!text) return undefined;
  try {
    const value = JSON.parse(text) as Partial<Cursor>;
    if (Number.isInteger(value.page) && Number.isInteger(value.perPage)) {
      return { page: value.page as number, perPage: value.perPage as number };
    }
  } catch {
    // Unreadable checkpoint: start the event over (upserts make that safe).
  }
  return undefined;
}

interface Counts {
  events: number;
  partialEvents: number;
  failedEvents: number;
  sets: number;
  dqSets: number;
  standings: number;
  noPlayer: number;
}

/** One row per player, keeping any non-null value seen (a page can list a player many times). */
function mergePlayers(rows: NormalizedPlayer[]): NormalizedPlayer[] {
  const byId = new Map<number, NormalizedPlayer>();
  for (const row of rows) {
    const old = byId.get(row.playerId);
    byId.set(row.playerId, {
      ...row,
      prefix: row.prefix ?? old?.prefix ?? null,
      userSlug: row.userSlug ?? old?.userSlug ?? null,
    });
  }
  return [...byId.values()];
}

async function writeSetsPage(
  db: Database,
  eventId: number,
  items: NormalizedSet[],
  cursor: Cursor,
): Promise<void> {
  await db.transaction(async (tx) => {
    if (items.length > 0) {
      await tx
        .insert(players)
        .values(
          mergePlayers(items.flatMap((s) => [s.winner, s.loser])).map((p) => ({
            id: p.playerId,
            gamerTag: p.gamerTag,
            prefix: p.prefix,
            userSlug: p.userSlug,
          })),
        )
        .onConflictDoUpdate({
          target: players.id,
          // Never erase a stored value with null; the tag is always present.
          set: {
            gamerTag: sql`excluded.gamer_tag`,
            prefix: sql`coalesce(excluded.prefix, ${players.prefix})`,
            userSlug: sql`coalesce(excluded.user_slug, ${players.userSlug})`,
          },
        });
      await tx
        .insert(sets)
        .values(
          items.map((s) => ({
            id: s.id,
            eventId,
            winnerId: s.winnerPlayerId,
            loserId: s.loserPlayerId,
            winnerGames: s.isDq ? null : s.winnerGames,
            loserGames: s.isDq ? null : s.loserGames,
            isDq: s.isDq,
            roundLabel: s.roundLabel,
            completedAt: s.completedAt,
            ratingPeriod: periodIndexFor(s.completedAt),
          })),
        )
        .onConflictDoUpdate({
          target: sets.id,
          set: {
            eventId: sql`excluded.event_id`,
            winnerId: sql`excluded.winner_id`,
            loserId: sql`excluded.loser_id`,
            winnerGames: sql`excluded.winner_games`,
            loserGames: sql`excluded.loser_games`,
            isDq: sql`excluded.is_dq`,
            roundLabel: sql`excluded.round_label`,
            completedAt: sql`excluded.completed_at`,
            ratingPeriod: sql`excluded.rating_period`,
          },
        });
    }
    // Same transaction as the rows, so a crash never loses or repeats a page.
    await tx
      .update(events)
      .set({ syncStatus: "partial", syncCursor: JSON.stringify(cursor) })
      .where(eq(events.id, eventId));
  });
}

/** Returns how many standings were stored (players we never saw in a set cannot be referenced). */
async function writeStandings(
  db: Database,
  eventId: number,
  items: { playerId: number; placement: number }[],
): Promise<{ stored: number; unknownPlayer: number }> {
  if (items.length === 0) return { stored: 0, unknownPlayer: 0 };
  const known = new Set(
    (
      await db
        .select({ id: players.id })
        .from(players)
        .where(
          inArray(
            players.id,
            items.map((i) => i.playerId),
          ),
        )
    ).map((r) => r.id),
  );
  const rows = items
    .filter((i) => known.has(i.playerId))
    .map((i) => ({ eventId, playerId: i.playerId, placement: i.placement }));
  if (rows.length > 0) {
    await db
      .insert(standings)
      .values(rows)
      .onConflictDoUpdate({
        target: [standings.eventId, standings.playerId],
        set: { placement: sql`excluded.placement` },
      });
  }
  return { stored: rows.length, unknownPlayer: items.length - rows.length };
}

/** Sync one event. Returns true if it finished, false if the time budget stopped it. */
async function syncEvent(ctx: JobContext, candidate: SyncCandidate, counts: Counts) {
  const { client, db, deadline, now } = ctx;
  const eventId = candidate.id;
  const resume = parseCursor(candidate.syncCursor);

  for await (const page of client.eventSetsPages(eventId, resume ? { cursor: resume } : {})) {
    counts.sets += page.items.length;
    counts.dqSets += page.items.filter((s) => s.isDq).length;
    counts.noPlayer += page.skipped;
    // On the last page keep pointing at it: a stop during standings redoes one page, no more.
    const checkpoint = page.nextCursor ?? { page: page.page, perPage: page.perPage };
    if (db) await writeSetsPage(db, eventId, page.items, checkpoint);
    if (page.nextCursor && deadline.expired()) return stop(counts);
  }

  for await (const page of client.eventStandingsPages(eventId)) {
    counts.noPlayer += page.skipped;
    if (db) {
      const result = await writeStandings(db, eventId, page.items);
      counts.standings += result.stored;
      counts.noPlayer += result.unknownPlayer;
    } else counts.standings += page.items.length;
    if (page.nextCursor && deadline.expired()) return stop(counts);
  }

  if (db) {
    await db
      .update(events)
      .set({ syncStatus: "done", syncCursor: null, lastSyncedAt: new Date(now()) })
      .where(eq(events.id, eventId));
  }
  counts.events++;
  return true;
}

/** The sets-page transaction already saved status partial and the cursor, so stopping only counts. */
function stop(counts: Counts): false {
  counts.events++;
  counts.partialEvents++;
  return false;
}

export async function sync(ctx: JobContext): Promise<JobResult> {
  const { args, db, readDb, deadline, now } = ctx;
  if (!readDb) {
    throw new UsageError(
      "sync needs DATABASE_URL to know which events qualify (even in a dry run)",
    );
  }
  let candidates: SyncCandidate[];
  if (args.event !== undefined) {
    const [row] = await readDb
      .select({
        id: events.id,
        syncCursor: events.syncCursor,
        qualifies: events.qualifies,
      })
      .from(events)
      .where(eq(events.id, args.event));
    if (!row)
      throw new UsageError(`event ${args.event} is not in the database; run discover first`);
    if (!row.qualifies) {
      throw new UsageError(
        `event ${args.event} does not qualify (online or too small); its sets and standings are never fetched`,
      );
    }
    candidates = [{ id: row.id, syncCursor: row.syncCursor }];
  } else {
    candidates = await selectEvents(readDb, new Date(now()));
  }

  const counts: Counts = {
    events: 0,
    partialEvents: 0,
    failedEvents: 0,
    sets: 0,
    dqSets: 0,
    standings: 0,
    noPlayer: 0,
  };
  let stoppedEarly = false;
  for (const candidate of candidates) {
    if (deadline.expired()) {
      stoppedEarly = true;
      break;
    }
    try {
      if (!(await syncEvent(ctx, candidate, counts))) stoppedEarly = true;
    } catch (error) {
      if (error instanceof StartggAuthError) throw error;
      counts.failedEvents++;
      process.stderr.write(`sync: event ${candidate.id} failed: ${redactError(error, [])}\n`);
      // The cursor of the last saved page is kept, so the next run resumes there.
      if (db)
        await db.update(events).set({ syncStatus: "error" }).where(eq(events.id, candidate.id));
    }
    if (stoppedEarly) break;
  }
  if (counts.failedEvents > 0 && counts.events === 0 && !stoppedEarly) {
    throw new Error(`all ${counts.failedEvents} event(s) failed to sync`);
  }

  return {
    eventsTouched: db ? counts.events + counts.failedEvents : 0,
    partial: stoppedEarly,
    summary:
      `${counts.events} events, ${counts.sets} sets (${counts.dqSets} DQ), ${counts.standings} standings, ` +
      `${counts.noPlayer} entrants without player` +
      (counts.failedEvents ? `, ${counts.failedEvents} failed` : "") +
      (stoppedEarly ? " (stopped early: time budget)" : ""),
  };
}

if (isMain(import.meta.url)) {
  process.exit(await runJob("sync", process.argv.slice(2), sync));
}
