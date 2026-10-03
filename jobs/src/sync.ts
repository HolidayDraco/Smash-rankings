import { and, asc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { periodIndexFor } from "@sr/core";
import { events, players, sets, standings, type Database } from "@sr/db";
import {
  StartggAuthError,
  type Cursor,
  type NormalizedPlayer,
  type NormalizedSet,
} from "@sr/startgg";
import { isMain, runJob, UsageError, type JobContext, type JobResult } from "./harness";

const HOUR_MS = 3_600_000;
/** Events handled per run; the rest wait for the next run. */
export const MAX_EVENTS_PER_RUN = 25;
/** A done event is re-checked once: it must have been last synced before start + 48 h... */
export const RESYNC_SYNCED_BEFORE_MS = 48 * HOUR_MS;
/** ...and the re-check happens once now > start + 72 h. After it, last_synced_at is past 48 h, so it cannot fire again. */
export const RESYNC_AFTER_START_MS = 72 * HOUR_MS;
/** A failed event waits this long after its last attempt (recorded in last_synced_at). */
export const ERROR_RETRY_AFTER_MS = 24 * HOUR_MS;
/** start.gg ActivityState of a finished event. Anything else is still live (or not yet closed). */
export const COMPLETED_STATE = "COMPLETED";

export interface SyncCandidate {
  id: number;
  syncCursor: string | null;
  /** events.state as stored by discover. */
  state: string | null;
}

/**
 * Which events to sync. All need `qualifies` and a start in the past, then:
 * 1. pending / partial (always, so live events stay fresh),
 * 2. done events due their single re-check: last_synced_at < start + 48 h and now > start + 72 h,
 * 3. error events, but only 24 h after their last attempt.
 * Groups are served in that order (so failing events cannot starve fresh ones),
 * least recently synced first, then oldest start. Capped.
 * Never selects qualifies = false events.
 */
export async function selectEvents(
  db: Database,
  now: Date,
  limit = MAX_EVENTS_PER_RUN,
): Promise<SyncCandidate[]> {
  const sinceStart = (ms: number) => sql`${events.startAt} + ${ms / 1000} * interval '1 second'`;
  const recheckDue = and(
    eq(events.syncStatus, "done"),
    isNotNull(events.lastSyncedAt),
    sql`${events.lastSyncedAt} < ${sinceStart(RESYNC_SYNCED_BEFORE_MS)}`,
    sql`${now.toISOString()}::timestamptz > ${sinceStart(RESYNC_AFTER_START_MS)}`,
  );
  const errorRetryDue = and(
    eq(events.syncStatus, "error"),
    or(
      isNull(events.lastSyncedAt),
      lt(events.lastSyncedAt, new Date(now.getTime() - ERROR_RETRY_AFTER_MS)),
    ),
  );
  return db
    .select({ id: events.id, syncCursor: events.syncCursor, state: events.state })
    .from(events)
    .where(
      and(
        eq(events.qualifies, true),
        lt(events.startAt, now),
        or(inArray(events.syncStatus, ["pending", "partial"]), recheckDue, errorRetryDue),
      ),
    )
    .orderBy(
      sql`case ${events.syncStatus} when 'done' then 1 when 'error' then 2 else 0 end`,
      sql`${events.lastSyncedAt} asc nulls first`,
      asc(events.startAt),
      asc(events.id),
    )
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
  cursor: Cursor | null,
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
    // Live events save no cursor: they restart at page 1 next run.
    await tx
      .update(events)
      .set({ syncStatus: "partial", syncCursor: cursor ? JSON.stringify(cursor) : null })
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
  // Two entrants can map to one player: keep the best (lowest) placement, one row per player.
  const best = new Map<number, number>();
  for (const { playerId, placement } of items) {
    best.set(playerId, Math.min(placement, best.get(playerId) ?? placement));
  }
  items = [...best].map(([playerId, placement]) => ({ playerId, placement }));
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

/** Delete this event's rows that a complete pass did not see (a set removed or reopened upstream). */
async function deleteUnseen(
  tx: Pick<Database, "select" | "delete">,
  eventId: number,
  seenSets: Set<number>,
  seenPlayers: Set<number>,
): Promise<void> {
  // An empty pass is more likely an upstream glitch than a wiped event: keep what we have.
  if (seenSets.size > 0) {
    const stored = await tx.select({ id: sets.id }).from(sets).where(eq(sets.eventId, eventId));
    const stale = stored.map((r) => r.id).filter((id) => !seenSets.has(id));
    for (let i = 0; i < stale.length; i += 1000) {
      await tx.delete(sets).where(inArray(sets.id, stale.slice(i, i + 1000)));
    }
  }
  if (seenPlayers.size > 0) {
    const stored = await tx
      .select({ id: standings.playerId })
      .from(standings)
      .where(eq(standings.eventId, eventId));
    const stale = stored.map((r) => r.id).filter((id) => !seenPlayers.has(id));
    for (let i = 0; i < stale.length; i += 1000) {
      await tx
        .delete(standings)
        .where(
          and(
            eq(standings.eventId, eventId),
            inArray(standings.playerId, stale.slice(i, i + 1000)),
          ),
        );
    }
  }
}

/**
 * Sync one event. Returns true if it finished, false if the time budget stopped it.
 *
 * A live event (state not COMPLETED) is fetched from page 1 every run, any
 * cursor is dropped, and it is never marked done. A COMPLETED event may resume
 * a saved cursor; a pass that started at page 1 also deletes rows it did not
 * see, then the event is marked done in the same transaction.
 */
async function syncEvent(ctx: JobContext, candidate: SyncCandidate, counts: Counts) {
  const { client, db, deadline, now } = ctx;
  const eventId = candidate.id;
  const completed = candidate.state === COMPLETED_STATE;
  const resume = completed ? parseCursor(candidate.syncCursor) : undefined;
  const seenSets = new Set<number>();
  const seenPlayers = new Set<number>();

  for await (const page of client.eventSetsPages(eventId, resume ? { cursor: resume } : {})) {
    counts.sets += page.items.length;
    counts.dqSets += page.items.filter((s) => s.isDq).length;
    counts.noPlayer += page.skipped;
    for (const item of page.items) seenSets.add(item.id);
    // On the last page keep pointing at it: a stop during standings redoes one page, no more.
    const checkpoint = completed
      ? (page.nextCursor ?? { page: page.page, perPage: page.perPage })
      : null;
    if (db) await writeSetsPage(db, eventId, page.items, checkpoint);
    if (page.nextCursor && deadline.expired()) return stop(db, candidate, counts, now());
  }

  for await (const page of client.eventStandingsPages(eventId)) {
    counts.noPlayer += page.skipped;
    if (db) {
      const result = await writeStandings(db, eventId, page.items);
      counts.standings += result.stored;
      counts.noPlayer += result.unknownPlayer;
    } else counts.standings += page.items.length;
    for (const item of page.items) seenPlayers.add(item.playerId);
    if (page.nextCursor && deadline.expired()) return stop(db, candidate, counts, now());
  }

  if (db) {
    await db.transaction(async (tx) => {
      if (!resume) await deleteUnseen(tx, eventId, seenSets, seenPlayers);
      await tx
        .update(events)
        .set(
          completed
            ? { syncStatus: "done", syncCursor: null, lastSyncedAt: new Date(now()) }
            : // Live: stays partial, fetched in full again next run.
              { syncStatus: "partial", syncCursor: null, lastSyncedAt: new Date(now()) },
        )
        .where(eq(events.id, eventId));
    });
  }
  counts.events++;
  return true;
}

/** The sets-page transaction already saved status partial and the cursor, so stopping mostly just counts. */
async function stop(
  db: Database | null,
  candidate: SyncCandidate,
  counts: Counts,
  nowMs: number,
): Promise<false> {
  // A live event restarts at page 1 anyway; record the attempt so others get their turn first.
  if (db && candidate.state !== COMPLETED_STATE) {
    await db
      .update(events)
      .set({ lastSyncedAt: new Date(nowMs) })
      .where(eq(events.id, candidate.id));
  }
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
        state: events.state,
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
    candidates = [{ id: row.id, syncCursor: row.syncCursor, state: row.state }];
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
      process.stderr.write(`sync: event ${candidate.id} failed: ${ctx.redact(error)}\n`);
      // The cursor of the last saved page is kept (a COMPLETED event resumes there). last_synced_at
      // records this attempt, so the event waits 24 h before it is picked again.
      if (db) {
        await db
          .update(events)
          .set({ syncStatus: "error", lastSyncedAt: new Date(now()) })
          .where(eq(events.id, candidate.id));
      }
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
