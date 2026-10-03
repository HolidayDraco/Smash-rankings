import type { EventNode, SetNode } from "./schemas";

export interface NormalizedSet {
  id: number;
  eventId: number;
  winnerPlayerId: number;
  loserPlayerId: number;
  winnerGames: number;
  loserGames: number;
  isDq: boolean;
  roundLabel: string | null;
  completedAt: Date;
}

/**
 * Turn a raw start.gg set into our shape, or null if it is not a finished
 * 1v1 set between two known players (byes, unfinished, doubles, deleted players).
 *
 * DQ detection is pending a live check: we treat displayScore "DQ" or any slot
 * score of -1 as a DQ (see docs/startgg-notes.md).
 */
export function normalizeSet(raw: SetNode, eventId: number): NormalizedSet | null {
  const slots = (raw.slots ?? []).filter((slot) => slot !== null);
  if (slots.length !== 2 || raw.winnerId === null || raw.completedAt === null) return null;
  const winner = slots.find((slot) => slot.entrant?.id === raw.winnerId);
  const loser = slots.find((slot) => slot !== winner);
  const winnerPlayerId = singlesPlayerId(winner?.entrant);
  const loserPlayerId = singlesPlayerId(loser?.entrant);
  if (!winner || !loser || winnerPlayerId === null || loserPlayerId === null) return null;

  const winnerScore = winner.standing?.stats?.score?.value ?? null;
  const loserScore = loser.standing?.stats?.score?.value ?? null;
  const isDq =
    /^dq$/i.test(raw.displayScore?.trim() ?? "") || winnerScore === -1 || loserScore === -1;
  return {
    id: raw.id,
    eventId,
    winnerPlayerId,
    loserPlayerId,
    winnerGames: isDq ? 0 : Math.max(0, winnerScore ?? 0),
    loserGames: isDq ? 0 : Math.max(0, loserScore ?? 0),
    isDq,
    roundLabel: raw.fullRoundText,
    completedAt: new Date(raw.completedAt * 1000),
  };
}

function singlesPlayerId(
  entrant:
    | { participants: readonly ({ player: { id: number } | null } | null)[] | null }
    | null
    | undefined,
) {
  const participants = entrant?.participants ?? [];
  if (participants.length !== 1) return null;
  return participants[0]?.player?.id ?? null;
}

/** start.gg event type 1 = singles, 5 = teams (pending live check). */
export function isSinglesEvent(event: Pick<EventNode, "type" | "teamRosterSize">): boolean {
  if (event.type !== null) return event.type === 1;
  return event.teamRosterSize === null || event.teamRosterSize.maxPlayers === 1;
}
