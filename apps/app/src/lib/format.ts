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
    reason.uncertaintyTooHigh ? "Rating still uncertain; plays more to settle." : null,
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
