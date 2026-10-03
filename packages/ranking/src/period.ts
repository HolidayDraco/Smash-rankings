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
