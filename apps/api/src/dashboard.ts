/* Pure helpers behind `GET /v1/dashboard`: time windows and small formatters. No I/O. */
import { EPOCH_MONDAY_MS, periodIndexFor, WEEK_MS } from "@sr/core";

const DAY_MS = 86_400_000;

export interface DashboardWindow {
  /** The current calendar year in UTC. */
  year: number;
  /** The current rating period (week index). */
  period: number;
  /** Monday 00:00 UTC of the current week (inclusive). */
  weekStart: Date;
  /** The next Monday 00:00 UTC (exclusive): the week runs to Sunday 24:00. */
  weekEnd: Date;
  /** January 1 00:00 UTC of `year` (inclusive). */
  yearStart: Date;
}

/** "This week" and "this year" for a request made at `now`. */
export function dashboardWindow(now: Date): DashboardWindow {
  const period = periodIndexFor(now); // throws on an invalid date
  const weekStart = new Date(EPOCH_MONDAY_MS + period * WEEK_MS);
  const year = now.getUTCFullYear();
  return {
    year,
    period,
    weekStart,
    weekEnd: new Date(weekStart.getTime() + WEEK_MS),
    yearStart: new Date(Date.UTC(year, 0, 1)),
  };
}

/** YYYY-MM-DD in UTC. */
export const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/** The Sunday that ends a week whose exclusive end is `weekEnd`, as YYYY-MM-DD. */
export const lastDayOfWeek = (weekEnd: Date) => isoDate(new Date(weekEnd.getTime() - DAY_MS));

/** "3-1" from stored game counts; null when either count is unknown (or invalid). */
export function formatSetScore(winnerGames: number | null, loserGames: number | null) {
  const valid = (games: number | null): games is number =>
    games !== null && Number.isSafeInteger(games) && games >= 0;
  return valid(winnerGames) && valid(loserGames) ? `${winnerGames}-${loserGames}` : null;
}

/** start.gg page for a stored slug, e.g. "tournament/x/event/y". */
export const startggUrlFor = (slug: string) => `https://www.start.gg/${slug}`;
