import { eq, sql } from "drizzle-orm";
import { meta, type Database } from "@sr/db";
import type { Cursor } from "@sr/startgg";
import { discoverWindow } from "./discover";
import type { JobContext, JobResult } from "./harness";

/**
 * Genghis's rule: at most 50 discover requests per UTC day, shared by the daily discover
 * inside sync and the backfill. The day is reserved so neither starves the other: sync 20,
 * backfill 30. From 12:00 UTC either may also use what the other left unused. Raise after the
 * first live check (P1-12) measures the real numbers.
 */
export const DISCOVER_REQUESTS_PER_DAY = 50;
export const SYNC_DISCOVER_SHARE = 20;
export const BACKFILL_DISCOVER_SHARE = 30;
export const SHARE_LEFTOVER_FROM_HOUR_UTC = 12;

export type DiscoverUser = "sync" | "backfill";
const SHARE: Record<DiscoverUser, number> = {
  sync: SYNC_DISCOVER_SHARE,
  backfill: BACKFILL_DISCOVER_SHARE,
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

async function spentToday(db: Pick<Database, "select">, nowMs: number) {
  if ((await getMeta(db, DISCOVER_DAY_KEY)) !== today(nowMs)) return { sync: 0, backfill: 0 };
  return {
    sync: Number(await getMeta(db, DISCOVER_SPENT_KEYS.sync)) || 0,
    backfill: Number(await getMeta(db, DISCOVER_SPENT_KEYS.backfill)) || 0,
  };
}

/** Requests `who` may still spend today (UTC): its own share, plus the other's unused share from 12:00 UTC; never past 50 in total. */
export async function remainingDiscoverBudget(
  db: Pick<Database, "select">,
  nowMs: number,
  who: DiscoverUser,
): Promise<number> {
  const spent = await spentToday(db, nowMs);
  const other: DiscoverUser = who === "sync" ? "backfill" : "sync";
  const afterNoon = new Date(nowMs).getUTCHours() >= SHARE_LEFTOVER_FROM_HOUR_UTC;
  const own = Math.max(0, SHARE[who] - spent[who]);
  const borrowed = afterNoon ? Math.max(0, SHARE[other] - spent[other]) : 0;
  return Math.max(
    0,
    Math.min(own + borrowed, DISCOVER_REQUESTS_PER_DAY - spent.sync - spent.backfill),
  );
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
