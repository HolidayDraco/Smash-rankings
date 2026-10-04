import { eq, sql } from "drizzle-orm";
import { meta, type Database } from "@sr/db";
import type { Cursor } from "@sr/startgg";
import { discoverWindow } from "./discover";
import type { JobContext, JobResult } from "./harness";

/**
 * Daily discover caps (per UTC day), one per job and never shared, so neither job can starve the
 * other: the hourly sync can't use up a late backfill's requests, and a long backfill can't eat
 * sync's daily pass (issue #35). Every request still goes through the client's 60 requests a
 * minute limiter (start.gg allows 80), so a cap only bounds how much one day may do.
 * - sync: 50 a day for its narrow daily window (about 42 requests a pass; a guess).
 * - backfill: 2,000 a day, enough to discover about a year of history in one run (about 125
 *   requests a month, a guess), which takes about 35 minutes at 60 a minute.
 */
export const SYNC_DISCOVER_PER_DAY = 50;
export const BACKFILL_DISCOVER_PER_DAY = 2_000;

export type DiscoverUser = "sync" | "backfill";
export const DISCOVER_CAP_PER_DAY: Record<DiscoverUser, number> = {
  sync: SYNC_DISCOVER_PER_DAY,
  backfill: BACKFILL_DISCOVER_PER_DAY,
};
/** meta keys: the UTC day (YYYY-MM-DD) requests were last spent, and what each job spent that day. */
export const DISCOVER_DAY_KEY = "discover_day";
export const DISCOVER_SPENT_KEYS: Record<DiscoverUser, string> = {
  sync: "discover_day_requests_sync",
  backfill: "discover_day_requests_backfill",
};

const today = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 10);

export async function getMeta(db: Pick<Database, "select">, key: string) {
  const [row] = await db.select().from(meta).where(eq(meta.key, key));
  return row?.value;
}
export const setMeta = (db: Pick<Database, "insert">, key: string, value: string) =>
  db
    .insert(meta)
    .values({ key, value })
    .onConflictDoUpdate({ target: meta.key, set: { value: sql`excluded.value` } });
export const deleteMeta = (db: Database, key: string) => db.delete(meta).where(eq(meta.key, key));

/** Reads a JSON meta value. A corrupt value counts as "nothing saved": it is deleted and a warning goes to stderr, so it cannot break every run. */
export async function readJsonMeta(db: Database, key: string): Promise<unknown> {
  const text = await getMeta(db, key);
  if (text === undefined || text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    process.stderr.write(
      `warning: saved value for "${key}" is not valid JSON; ignoring and deleting it\n`,
    );
    await deleteMeta(db, key);
    return null;
  }
}

async function spentToday(db: Pick<Database, "select">, nowMs: number) {
  if ((await getMeta(db, DISCOVER_DAY_KEY)) !== today(nowMs)) return { sync: 0, backfill: 0 };
  return {
    sync: Number(await getMeta(db, DISCOVER_SPENT_KEYS.sync)) || 0,
    backfill: Number(await getMeta(db, DISCOVER_SPENT_KEYS.backfill)) || 0,
  };
}

/** Requests `who` may still spend today (UTC): its own cap minus what it already spent today. */
export async function remainingDiscoverBudget(
  db: Pick<Database, "select">,
  nowMs: number,
  who: DiscoverUser,
): Promise<number> {
  const spent = await spentToday(db, nowMs);
  return Math.max(0, DISCOVER_CAP_PER_DAY[who] - spent[who]);
}

/** One transaction, so the day and the counts never disagree. */
async function recordSpend(
  db: Database,
  nowMs: number,
  who: DiscoverUser,
  requests: number,
): Promise<void> {
  if (requests <= 0) return;
  await db.transaction(async (tx) => {
    const spent = await spentToday(tx, nowMs);
    await setMeta(tx, DISCOVER_DAY_KEY, today(nowMs));
    await setMeta(tx, DISCOVER_SPENT_KEYS[who], String(spent[who] + requests));
    const other: DiscoverUser = who === "sync" ? "backfill" : "sync";
    await setMeta(tx, DISCOVER_SPENT_KEYS[other], String(spent[other]));
  });
}

/**
 * Discover a window, drawing from today's budget. Returns null when `who` has nothing left
 * (nothing was requested). Otherwise stops paging at the remaining budget (partial) and
 * records what it spent, even when discover throws. A recording failure never hides the
 * original error (a bad token must still surface).
 */
export async function discoverBudgeted(
  ctx: JobContext,
  db: Database,
  who: DiscoverUser,
  from: Date,
  to: Date,
  opts: { cursor?: Cursor; onPage?: (next: Cursor) => Promise<void> } = {},
): Promise<(JobResult & { resume: Cursor | null }) | null> {
  const remaining = await remainingDiscoverBudget(db, ctx.now(), who);
  if (remaining <= 0) return null;
  const before = ctx.client.requestsUsed;
  const record = () => recordSpend(db, ctx.now(), who, ctx.client.requestsUsed - before);
  let result: JobResult & { resume: Cursor | null };
  try {
    result = await discoverWindow(ctx, from, to, { ...opts, maxRequests: remaining });
  } catch (error) {
    await record().catch((recordError: unknown) => {
      process.stderr.write(
        `discover: could not record request spend: ${ctx.redact(recordError)}\n`,
      );
    });
    throw error;
  }
  await record();
  return result;
}
