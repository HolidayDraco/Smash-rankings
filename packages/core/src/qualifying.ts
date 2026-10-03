import { QUALIFYING_EVENT_RULES, ULTIMATE_VIDEOGAME_ID } from "./constants";

/** The start.gg event facts the rules need. Structural, so core does not depend on the client. */
export interface EventFacts {
  videogameId: number | null;
  numEntrants: number | null;
  /** start.gg `Event.type`: 1 = singles, 5 = teams (pending live check). */
  type: number | null;
  teamRosterSize: { maxPlayers: number | null } | null;
  isOnline: boolean | null;
  /** Fallback when the event itself does not say. */
  tournamentIsOnline?: boolean | null;
}

export type EventClass = "qualifies" | "stored-not-qualifying" | "skip";

/** Singles signal. Pending live check: if start.gg encodes it differently, fix only this function. */
export function isSinglesEvent(event: Pick<EventFacts, "type" | "teamRosterSize">): boolean {
  if (event.type !== null) return event.type === 1;
  return event.teamRosterSize === null || event.teamRosterSize.maxPlayers === 1;
}

/**
 * Online signal. Pending live check: if start.gg encodes it differently, fix only this function.
 * Uses the event flag, then the tournament flag; unknown counts as in person.
 */
export function isOnlineEvent(event: Pick<EventFacts, "isOnline" | "tournamentIsOnline">): boolean {
  return event.isOnline ?? event.tournamentIsOnline ?? false;
}

/**
 * Which events we keep (blueprint decisions 2 and 3):
 * - Ultimate singles, at least 64 entrants, in person: "qualifies".
 * - Same but online: stored for reference, never rated.
 * - Anything smaller, doubles, or another game: "skip" (not stored: minimum data).
 */
export function classifyEvent(
  event: EventFacts,
  rules: typeof QUALIFYING_EVENT_RULES = QUALIFYING_EVENT_RULES,
): EventClass {
  if (event.videogameId !== ULTIMATE_VIDEOGAME_ID) return "skip";
  if (event.numEntrants === null || event.numEntrants < rules.minEntrants) return "skip";
  if (rules.singlesOnly && !isSinglesEvent(event)) return "skip";
  if (isOnlineEvent(event) && !rules.allowOnline) return "stored-not-qualifying";
  return "qualifies";
}
