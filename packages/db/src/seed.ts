/**
 * SYNTHETIC demo data for local development, previews, and API tests. Every
 * name is obviously fake ("Sample_…"); nothing here comes from start.gg.
 *
 * All synthetic rows use ids in a reserved range far above real start.gg ids,
 * so re-seeding deletes exactly the rows it created and never touches real data.
 */
import { periodIndexFor } from "@sr/core";
import { and, gte, lt } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Database } from "./client";
import {
  events,
  ingestRuns,
  leaderboard,
  meta,
  players,
  sets,
  standings,
  tournaments,
} from "./schema";

export const SYNTHETIC_ID_MIN = 9_000_000_000_000;
const SYNTHETIC_ID_MAX = SYNTHETIC_ID_MIN + 1_000_000;

const TAG_WORDS = [
  "Ace",
  "Blaze",
  "Comet",
  "Dash",
  "Echo",
  "Flint",
  "Glide",
  "Halo",
  "Ion",
  "Jolt",
  "Kite",
  "Lumen",
  "Mako",
  "Nova",
  "Onyx",
  "Pike",
  "Quill",
  "Rook",
  "Sage",
  "Tide",
  "Umbra",
  "Vex",
  "Wisp",
  "Xeno",
  "Yarrow",
  "Zephyr",
  "Brook",
  "Cinder",
  "Drift",
  "Ember",
];
const COUNTRIES = ["US", "CA", "MX", "JP", "FR", "GB"];
const TOURNAMENT_NAMES = ["Sample Showdown", "Sample Invitational", "Sample Regional"];
const SETS_PER_EVENT = 45;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Tiny deterministic PRNG (mulberry32) so every seed produces the same sets. */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export interface SeedOptions {
  /** Clock for every generated timestamp (tests pass a fixed date). */
  now?: Date;
  /** Leave existing `meta` rows alone (only fill missing keys). Used for real databases. */
  keepExistingMeta?: boolean;
}

/** Delete earlier synthetic rows and insert a fresh set, in one transaction. */
export async function seedSynthetic(
  db: Database,
  { now = new Date(), keepExistingMeta = false }: SeedOptions = {},
): Promise<void> {
  const random = createRandom(1386);
  const id = (offset: number) => SYNTHETIC_ID_MIN + offset;
  const inRange = (column: AnyPgColumn) =>
    and(gte(column, SYNTHETIC_ID_MIN), lt(column, SYNTHETIC_ID_MAX));

  const playerRows = TAG_WORDS.map((word, index) => ({
    id: id(index + 1),
    gamerTag: `Sample_${word}`,
    countryCode: COUNTRIES[index % COUNTRIES.length] ?? null,
  }));
  const tournamentRows = TOURNAMENT_NAMES.map((name, index) => ({
    id: id(index + 1),
    slug: `tournament/synthetic-${index + 1}`,
    name,
    startAt: new Date(now.getTime() - (3 - index) * 3 * WEEK_MS),
    numAttendees: 64 + index * 32,
  }));
  const eventRows = tournamentRows.map((tournament, index) => ({
    id: id(index + 1),
    tournamentId: tournament.id,
    slug: `${tournament.slug}/event/ultimate-singles`,
    name: "Ultimate Singles",
    startAt: tournament.startAt,
    numEntrants: tournament.numAttendees,
    state: "COMPLETED",
    qualifies: true,
    syncStatus: "done" as const,
  }));

  const setRows: (typeof sets.$inferInsert)[] = [];
  const setsPlayed = new Map<number, number>();
  for (const event of eventRows) {
    for (let index = 0; index < SETS_PER_EVENT; index++) {
      const a = Math.floor(random() * playerRows.length);
      const b = (a + 1 + Math.floor(random() * (playerRows.length - 1))) % playerRows.length;
      // The higher-listed player wins 75% of the time, so the leaderboard looks plausible.
      const [winner, loser] = a < b === random() < 0.75 ? [a, b] : [b, a];
      const completedAt = new Date(event.startAt.getTime() + index * 600_000);
      setRows.push({
        id: id(setRows.length + 1),
        eventId: event.id,
        winnerId: id(winner + 1),
        loserId: id(loser + 1),
        winnerGames: 2,
        loserGames: Math.floor(random() * 2),
        completedAt,
        ratingPeriod: periodIndexFor(completedAt),
      });
      for (const player of [winner, loser])
        setsPlayed.set(player, (setsPlayed.get(player) ?? 0) + 1);
    }
  }

  let rank = 0;
  const leaderboardRows = playerRows.map((player, index) => {
    const rating = 2000 - index * 20;
    const rd = 60 + index * 2;
    const eligible = rd <= 110 && (setsPlayed.get(index) ?? 0) >= 10;
    return {
      playerId: player.id,
      rank: eligible ? ++rank : null,
      conservativeScore: rating - 2 * rd,
      rating,
      rd,
      rankDelta7d: eligible ? (index % 5) - 2 : null,
      lastActiveAt: eventRows.at(-1)?.startAt ?? now,
      eligible,
      countryCode: player.countryCode,
      setsPlayed: setsPlayed.get(index) ?? 0,
      eventsPlayed: eventRows.length,
    };
  });

  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
  const runRows = [
    {
      job: "sync",
      startedAt: hoursAgo(26),
      finishedAt: hoursAgo(25.9),
      status: "error",
      error: "Synthetic: start.gg timed out",
    },
    { job: "discover", startedAt: hoursAgo(3), finishedAt: hoursAgo(2.95), status: "success" },
    { job: "sync", startedAt: hoursAgo(2), finishedAt: hoursAgo(1.8), status: "success" },
    {
      job: "backfill",
      startedAt: hoursAgo(5),
      finishedAt: hoursAgo(4.5),
      status: "error",
      error: "Synthetic: query complexity too high",
    },
    { job: "rate", startedAt: hoursAgo(1), finishedAt: hoursAgo(0.9), status: "success" },
  ] as const;

  await db.transaction(async (tx) => {
    // Children first: sets/standings reference players without cascading.
    await tx.delete(sets).where(inRange(sets.id));
    await tx.delete(standings).where(inRange(standings.eventId));
    await tx.delete(leaderboard).where(inRange(leaderboard.playerId));
    await tx.delete(events).where(inRange(events.id));
    await tx.delete(tournaments).where(inRange(tournaments.id));
    await tx.delete(players).where(inRange(players.id));
    await tx.delete(ingestRuns).where(inRange(ingestRuns.id));

    await tx.insert(players).values(playerRows);
    await tx.insert(tournaments).values(tournamentRows);
    await tx.insert(events).values(eventRows);
    await tx.insert(sets).values(setRows);
    await tx.insert(standings).values(
      eventRows.flatMap((event) =>
        playerRows.map((player, index) => ({
          eventId: event.id,
          playerId: player.id,
          placement: index + 1,
        })),
      ),
    );
    await tx.insert(leaderboard).values(leaderboardRows);
    await tx
      .insert(ingestRuns)
      .overridingSystemValue()
      .values(runRows.map((run, index) => ({ ...run, id: id(index + 1) })));
    for (const [key, value] of [
      ["data_version", "1"],
      ["last_rated_at", hoursAgo(0.9).toISOString()],
    ] as const) {
      const insert = tx.insert(meta).values({ key, value });
      await (keepExistingMeta
        ? insert.onConflictDoNothing({ target: meta.key })
        : insert.onConflictDoUpdate({ target: meta.key, set: { value } }));
    }
  });
}
