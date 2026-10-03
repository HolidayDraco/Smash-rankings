import type { SetNode } from "./schemas";

/** What sync needs to upsert a players row before the set that references it. */
export interface NormalizedPlayer {
  playerId: number;
  gamerTag: string;
  prefix: string | null;
  userSlug: string | null;
}

export interface NormalizedSet {
  id: number;
  eventId: number;
  winnerPlayerId: number;
  loserPlayerId: number;
  winner: NormalizedPlayer;
  loser: NormalizedPlayer;
  /** Null when unknown: DQ sets, or a finished set with no score reported. */
  winnerGames: number | null;
  loserGames: number | null;
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
  const winnerPlayer = singlesPlayer(winner?.entrant);
  const loserPlayer = singlesPlayer(loser?.entrant);
  if (!winner || !loser || !winnerPlayer || !loserPlayer) return null;
  // The DB has a check constraint against a player beating themselves (duplicate entries).
  if (winnerPlayer.playerId === loserPlayer.playerId) return null;

  const winnerScore = winner.standing?.stats?.score?.value ?? null;
  const loserScore = loser.standing?.stats?.score?.value ?? null;
  const isDq =
    /^dq$/i.test(raw.displayScore?.trim() ?? "") || winnerScore === -1 || loserScore === -1;
  return {
    id: raw.id,
    eventId,
    winnerPlayerId: winnerPlayer.playerId,
    loserPlayerId: loserPlayer.playerId,
    winner: winnerPlayer,
    loser: loserPlayer,
    winnerGames: isDq ? null : gamesWon(winnerScore),
    loserGames: isDq ? null : gamesWon(loserScore),
    isDq,
    roundLabel: raw.fullRoundText,
    completedAt: new Date(raw.completedAt * 1000),
  };
}

function gamesWon(score: number | null): number | null {
  return score === null || score < 0 ? null : score;
}

type RawEntrant =
  | {
      participants: readonly ({ player: RawPlayer | null } | null)[] | null;
    }
  | null
  | undefined;
type RawPlayer = {
  id: number;
  gamerTag: string | null;
  prefix: string | null;
  user: { slug: string | null } | null;
};

/** The single player of a 1v1 entrant. Null for teams or players with no gamer tag (players.gamer_tag is NOT NULL). */
function singlesPlayer(entrant: RawEntrant): NormalizedPlayer | null {
  const participants = entrant?.participants ?? [];
  const player = participants.length === 1 ? participants[0]?.player : null;
  if (!player?.gamerTag) return null;
  return {
    playerId: player.id,
    gamerTag: player.gamerTag,
    prefix: player.prefix || null,
    userSlug: player.user?.slug ?? null,
  };
}

// The singles signal lives in @sr/core with the other qualifying rules.
export { isSinglesEvent } from "@sr/core";
