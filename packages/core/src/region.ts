import { LAUNCH_REGIONS, STATE_NAMES } from "./constants";

/** Where a tournament was held, as start.gg reports it. */
export interface TournamentLocation {
  countryCode: string | null;
  addrState: string | null;
}

const normalize = (value: string) => value.trim().toLowerCase();

/**
 * True when the tournament was held in a launch region (ADR-0003).
 * The state matches case-insensitively, as a code ("TX") or full name ("Texas"), because
 * start.gg's format is unverified. A missing country relies on the state alone; a set
 * country other than the region's is out. No state (online events) is never in region.
 */
export function isInLaunchRegion(
  tournament: TournamentLocation,
  region: { countryCode: string; states: readonly string[] } = LAUNCH_REGIONS,
): boolean {
  if (tournament.countryCode !== null && tournament.countryCode.trim() !== "") {
    if (normalize(tournament.countryCode) !== normalize(region.countryCode)) return false;
  }
  if (tournament.addrState === null) return false;
  const state = normalize(tournament.addrState);
  return region.states.some(
    (code) =>
      state === normalize(code) ||
      (STATE_NAMES[code] !== undefined && state === normalize(STATE_NAMES[code])),
  );
}
