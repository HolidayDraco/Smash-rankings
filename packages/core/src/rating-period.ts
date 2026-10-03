/**
 * Rating periods are whole weeks. Period 0 is the week starting Monday
 * 1970-01-05 00:00 UTC. This is the one canonical definition; @sr/ranking re-exports it.
 */
export const WEEK_MS = 604_800_000;
/** Monday 1970-01-05 00:00 UTC: the start of period 0. */
export const EPOCH_MONDAY_MS = Date.UTC(1970, 0, 5);

export function periodIndexFor(date: Date): number {
  const time = date.getTime();
  if (!Number.isFinite(time)) throw new RangeError("periodIndexFor: invalid date");
  return Math.floor((time - EPOCH_MONDAY_MS) / WEEK_MS);
}
