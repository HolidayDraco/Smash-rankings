import type { Scene } from "@sr/core";

const byCity = (a: Scene, b: Scene) =>
  a.city.localeCompare(b.city, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id);

/**
 * Filter scenes by city name (case-insensitive substring), then list pinned cities first.
 * Both groups are alphabetical by city. Pure: inputs are never modified.
 */
export function arrangeScenes(
  scenes: readonly Scene[],
  pinnedIds: ReadonlySet<string>,
  query: string,
): Scene[] {
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? scenes.filter((scene) => scene.city.toLowerCase().includes(needle))
    : [...scenes];
  const pinned = matches.filter((scene) => pinnedIds.has(scene.id)).sort(byCity);
  const rest = matches.filter((scene) => !pinnedIds.has(scene.id)).sort(byCity);
  return [...pinned, ...rest];
}

export function togglePin(pinnedIds: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(pinnedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export const PINS_STORAGE_KEY = "sr.texas.pins";

/** Parse saved pins, keeping only known ids. Anything malformed gives an empty set. */
export function parsePins(raw: string | null, knownIds: readonly string[]): Set<string> {
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return new Set();
    const known = new Set(knownIds);
    return new Set(value.filter((id): id is string => typeof id === "string" && known.has(id)));
  } catch {
    return new Set();
  }
}
