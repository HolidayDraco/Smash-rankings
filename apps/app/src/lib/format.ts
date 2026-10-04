import { REGION_TIME_ZONE } from "@sr/core";
/** URL-safe lowercase slug from a gamer tag ("Sample_Ace" becomes "sample-ace"). */
export function slugify(tag: string): string {
  return (
    tag
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "player"
  );
}

/** Link target for a player. P1-9 builds the page behind this single `[idSlug]` segment. */
export const playerHref = (playerId: string, tag: string) =>
  `/player/${playerId}-${slugify(tag)}` as const;

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Player id from the `[idSlug]` route segment ("1234-sample-ace" gives "1234"); null when invalid. */
export function parsePlayerId(idSlug: string | undefined): string | null {
  const match = /^([1-9]\d{0,14})(?:-.*)?$/.exec(idSlug ?? "");
  return match?.[1] ?? null;
}

/** 1 gives "1st", 4 gives "4th", 12 gives "12th", 22 gives "22nd". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  const suffix =
    mod100 >= 11 && mod100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** "4th of 128", or just "4th" when the entrant count is unknown. */
export const formatPlacement = (placement: number, entrants: number | null) =>
  entrants ? `${ordinal(placement)} of ${entrants}` : ordinal(placement);

const plural = (n: number, word: string) => `${n} more ${word}${n === 1 ? "" : "s"}`;

/** Plain-English reason a player is not on the leaderboard yet. */
export function describeNotRanked(reason: {
  setsNeeded: number;
  eventsNeeded: number;
  uncertaintyTooHigh: boolean;
}): string {
  const needs = [
    reason.setsNeeded > 0 ? plural(reason.setsNeeded, "rated set") : null,
    reason.eventsNeeded > 0 ? plural(reason.eventsNeeded, "event") : null,
  ].filter(Boolean);
  const parts = [
    needs.length > 0 ? `Needs ${needs.join(" and ")}.` : null,
    reason.uncertaintyTooHigh ? "Needs more sets for the rating to settle." : null,
  ].filter(Boolean);
  return parts.join(" ") || "Waiting for the next ranking update.";
}

/** "Mar 3, 2026" (UTC, so every visitor sees the same date). */
export const formatDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "Date unknown";

/** Week change for the Dashboard: "▲2", "▼1", "—" for no change, "NEW" when there is no last-week rank. */
export function weekDeltaText(delta: number | null): string {
  if (delta === null) return "NEW";
  if (delta === 0) return "—";
  return `${delta > 0 ? "▲" : "▼"}${Math.abs(delta)}`;
}

/** Same change, spoken: "up 2", "down 1", "no change", "new". */
export function weekDeltaSpoken(delta: number | null): string {
  if (delta === null) return "new";
  if (delta === 0) return "no change";
  return `${delta > 0 ? "up" : "down"} ${Math.abs(delta)}`;
}

const utcDay = (isoDate: string) => new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
/** "Mon Sep 28", built by hand so every platform prints it the same way (no commas). */
const dayText = (date: Date) =>
  `${WEEKDAYS[date.getUTCDay()]} ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;

/** "Week of Mon Sep 28 – Sun Oct 4" from two YYYY-MM-DD dates. */
export const formatWeekRange = (weekStart: string, weekEnd: string) =>
  `Week of ${dayText(utcDay(weekStart))} – ${dayText(utcDay(weekEnd))}`;

/** "Sat Oct 3" (UTC, like the rest of the app). */
/**
 * "Tue Sep 29" in the launch region's time zone, so an 8 pm Tuesday weekly (01:00 UTC Wednesday)
 * still reads as Tuesday. Same output on every machine, so it is safe for the static export.
 */
export function formatEventDay(iso: string, timeZone: string = REGION_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("month")} ${part("day")}`;
}

/** "and 3 more" when the API matched more events than it listed; null otherwise. */
export const moreEventsText = (total: number, shown: number): string | null =>
  total > shown ? `and ${total - shown} more` : null;

/** "3-1" becomes "3–1" (a real en dash); anything else passes through. */
export const formatSetScore = (score: string) => score.replace(/^(\d+)-(\d+)$/, "$1–$2");

/** "Sample_Halo beat Sample_Kite 3–1", the plain-language form of an upset. */
export const describeUpset = (winner: string, loser: string, score: string | null) =>
  `${winner} beat ${loser}${score ? ` ${formatSetScore(score)}` : ""}`;
