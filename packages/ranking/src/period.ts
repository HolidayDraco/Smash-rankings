import { EPOCH_MONDAY_MS, LEADERBOARD_ELIGIBILITY, periodIndexFor, WEEK_MS } from "@sr/core";

const DAY_MS = 86_400_000;

/**
 * The ISO-8601 week (UTC, weeks start Monday 00:00) that `date` falls in,
 * formatted like "2026-W40". The week-year can differ from the calendar year
 * near Jan 1 (e.g. 2024-12-30 is "2025-W01"). Ids sort chronologically as strings.
 */
export function ratingPeriodFor(date: Date): string {
  const time = date.getTime();
  if (!Number.isFinite(time)) throw new RangeError("ratingPeriodFor: invalid date");
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  // ISO rule: a week belongs to the year that contains its Thursday.
  const thursday = new Date(midnight + (3 - daysSinceMonday) * DAY_MS);
  const weekYear = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(weekYear, 0, 1)) / (7 * DAY_MS));
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

// One canonical definition lives in @sr/core (the sync job uses it too).
export { periodIndexFor } from "@sr/core";

/** Monday 00:00 UTC that starts the given period. */
export function periodStart(period: number): Date {
  if (!Number.isSafeInteger(period)) throw new RangeError("periodStart: period must be an integer");
  return new Date(EPOCH_MONDAY_MS + period * WEEK_MS);
}

/** Period index → ISO week id, e.g. 2960 → "2026-W40". */
export function periodIndexToIsoWeek(period: number): string {
  return ratingPeriodFor(periodStart(period));
}

/** ISO week id (e.g. "2026-W40") → period index. Rejects weeks that don't exist. */
export function isoWeekToPeriodIndex(isoWeek: string): number {
  const match = /^(\d{4})-W(\d{2})$/.exec(isoWeek);
  if (!match) throw new RangeError(`isoWeekToPeriodIndex: bad ISO week "${isoWeek}"`);
  const year = Number(match[1]);
  const week = Number(match[2]);
  // Week 1 is the week containing Jan 4.
  const jan4 = Date.UTC(year, 0, 4);
  const week1Monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS;
  const period = periodIndexFor(new Date(week1Monday + (week - 1) * WEEK_MS));
  if (week < 1 || periodIndexToIsoWeek(period) !== isoWeek) {
    throw new RangeError(`isoWeekToPeriodIndex: no such week "${isoWeek}"`);
  }
  return period;
}

/**
 * The periods a run rates: the `trailingWeeks` weeks ending at `asOfPeriod`,
 * inclusive (ADR-0002: 52 weeks, everyone starts fresh at `fromPeriod`).
 */
export function ratingWindow(
  asOfPeriod: number,
  trailingWeeks: number = LEADERBOARD_ELIGIBILITY.trailingWeeks,
): { fromPeriod: number; toPeriod: number } {
  if (!Number.isSafeInteger(asOfPeriod) || !Number.isSafeInteger(trailingWeeks)) {
    throw new RangeError("ratingWindow: asOfPeriod and trailingWeeks must be integers");
  }
  if (trailingWeeks < 1) throw new RangeError("ratingWindow: trailingWeeks must be at least 1");
  return { fromPeriod: asOfPeriod - trailingWeeks + 1, toPeriod: asOfPeriod };
}
