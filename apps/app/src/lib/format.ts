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
