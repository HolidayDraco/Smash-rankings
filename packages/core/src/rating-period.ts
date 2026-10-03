/**
 * Rating periods are whole weeks. Period 0 is the week starting Monday
 * 1970-01-05 00:00 UTC. @sr/ranking has the same definition; keep them equal.
 */
const WEEK_MS = 604_800_000;
const PERIOD_ZERO_MS = Date.UTC(1970, 0, 5);

export function periodIndexFor(date: Date): number {
  return Math.floor((date.getTime() - PERIOD_ZERO_MS) / WEEK_MS);
}
