import { eq } from "drizzle-orm";
import { meta, type Database } from "@sr/db";
import { z } from "zod";
import { DAY_MS } from "./discover";
import { deleteMeta, discoverBudgeted, getMeta, setMeta } from "./discover-budget";
import { isMain, runJob, type JobContext, type JobResult } from "./harness";
import { MAX_EVENTS_PER_RUN, selectEvents, syncCandidates } from "./sync";

export const BACKFILL_DEFAULT_MONTHS = 12;
/** Nightly cap; the workflow's timeout is 90 minutes, which leaves headroom. */
export const BACKFILL_DEFAULT_BUDGET_MINUTES = 75;
/** meta key: start of the oldest month fully finished (ISO). */
export const BACKFILL_CURSOR_KEY = "backfill_cursor";
/** meta key: where this backfill left off inside a month, JSON {from, cursor?, done?}. */
export const BACKFILL_DISCOVER_CURSOR_KEY = "backfill_discover_cursor";
/** meta key: when the backfill last reached its target (ISO). */
export const BACKFILL_DONE_KEY = "backfill_done_at";
/** Rough guesses, NOT measured (see docs/startgg-notes.md): used only for the dry-run estimate. */
export const ESTIMATE = { discoverPerMonth: 125, qualifyingEventsPerMonth: 150, perEvent: 9 };

/** First day of the UTC month, `offset` months from `date`. */
export function monthStart(date: Date, offset: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
}

/** The calendar months still to do, newest first: this month back to `months` months ago, minus finished ones. */
export function monthsToCover(now: Date, months: number, cursor: Date | null) {
  const oldest = monthStart(now, -months);
  const windows: { from: Date; to: Date }[] = [];
  for (let k = 0; k <= months; k++) {
    const from = monthStart(now, -k);
    if (cursor && from >= cursor) continue;
    windows.push({ from, to: monthStart(now, -k + 1) });
  }
  return { oldest, windows };
}

async function readCursor(db: Pick<Database, "select">): Promise<Date | null> {
  const [row] = await db.select().from(meta).where(eq(meta.key, BACKFILL_CURSOR_KEY));
  const date = row ? new Date(row.value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

/** Where discover stopped inside one month: continue there (or skip discover if it had finished). */
const monthProgressSchema = z.object({
  from: z.string(),
  done: z.boolean().optional(),
  cursor: z.object({ page: z.number().int(), perPage: z.number().int() }).optional(),
});

export async function backfill(ctx: JobContext): Promise<JobResult> {
  const { args, db, readDb, deadline, now, progress, out } = ctx;
  const months = args.months ?? BACKFILL_DEFAULT_MONTHS;
  const cursor = readDb ? await readCursor(readDb) : null;
  const { oldest, windows } = monthsToCover(new Date(now()), months, cursor);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  if (cursor && cursor <= oldest) {
    return { eventsTouched: 0, summary: `already done (finished back to ${day(cursor)})` };
  }
  if (args.dryRun || !db) {
    const requests =
      windows.length *
      (ESTIMATE.discoverPerMonth + ESTIMATE.qualifyingEventsPerMonth * ESTIMATE.perEvent);
    out(
      `plan: ${windows.length} month(s), newest first: ${windows.map((w) => day(w.from)).join(", ")}`,
    );
    return {
      eventsTouched: 0,
      summary:
        `would cover ${windows.length} month(s) back to ${day(oldest)}; roughly ${requests} requests ` +
        `(a guess, about ${Math.round(requests / 60)} minutes at 60 a minute) in nightly runs of ${args.timeBudgetMinutes} minutes`,
    };
  }

  let finished = 0;
  let partial = false;
  const saved = monthProgressSchema.safeParse(
    JSON.parse((await getMeta(db, BACKFILL_DISCOVER_CURSOR_KEY)) ?? "null"),
  );
  for (const { from, to } of windows) {
    const resumeHere = saved.success && saved.data.from === from.toISOString() ? saved.data : null;
    if (!resumeHere?.done) {
      // Discover draws from the shared 50 a day budget and stops mid-month when it runs out.
      const found = await discoverBudgeted(ctx, db, "backfill", from, to, {
        cursor: resumeHere?.cursor,
        // Saved after every page, so a crash or error resumes at the page that failed.
        onPage: (next) =>
          setMeta(
            db,
            BACKFILL_DISCOVER_CURSOR_KEY,
            JSON.stringify({ from: from.toISOString(), cursor: next }),
          ).then(() => undefined),
      });
      if (!found || found.partial) {
        partial = true;
        break;
      }
      await setMeta(
        db,
        BACKFILL_DISCOVER_CURSOR_KEY,
        JSON.stringify({ from: from.toISOString(), done: true }),
      );
    }
    // Sync this month's qualifying events (never online ones: selectEvents filters qualifies = true).
    // Failures are logged and retried later by the regular sync; they never fail the backfill.
    const handled: number[] = [];
    for (;;) {
      if (deadline.expired()) {
        partial = true;
        break;
      }
      const batch = await selectEvents(db, new Date(now()), MAX_EVENTS_PER_RUN, {
        // A tournament can start in this month and its event a few days into the next (see startgg-notes).
        window: { from, to: new Date(to.getTime() + 7 * DAY_MS) },
        excludeIds: handled,
      });
      if (batch.length === 0) break;
      handled.push(...batch.map((c) => c.id));
      const result = await syncCandidates(ctx, batch);
      progress.eventsTouched += result.counts.events + result.counts.failedEvents;
      if (result.stoppedEarly) {
        partial = true;
        break;
      }
    }
    if (partial) break;
    await setMeta(db, BACKFILL_CURSOR_KEY, from.toISOString());
    await deleteMeta(db, BACKFILL_DISCOVER_CURSOR_KEY);
    finished++;
    out(`backfill: finished ${day(from)}`);
  }
  if (!partial) await setMeta(db, BACKFILL_DONE_KEY, new Date(now()).toISOString());
  return {
    eventsTouched: progress.eventsTouched,
    partial,
    summary:
      `${finished} of ${windows.length} month(s) finished, back to ${day(oldest)} is the goal` +
      (partial ? " (stopped early: resumes next run)" : " (done)"),
  };
}

if (isMain(import.meta.url)) {
  // Backfill gets a longer default budget; a --time-budget-minutes flag later in argv still wins.
  const argv = process.argv.slice(2).filter((arg, i) => !(arg === "--" && i === 0));
  process.exit(
    await runJob(
      "backfill",
      ["--time-budget-minutes", String(BACKFILL_DEFAULT_BUDGET_MINUTES), ...argv],
      backfill,
    ),
  );
}
