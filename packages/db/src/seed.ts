/**
 * SYNTHETIC demo data for local development, previews, and API tests. Every
 * name is obviously fake ("Sample_…"); nothing here comes from start.gg.
 *
 * All synthetic rows use ids in a reserved range far above real start.gg ids,
 * so re-seeding deletes exactly the rows it created and never touches real data.
 *
 * Everything is placed relative to `now` (default: the moment you run the seed), so the
 * Dashboard always has something to show on the day e2e tests or screenshots run:
 * - three older events, 9, 6 and 3 weeks before `now` (always before this week);
 * - two "this week" events, with their sets and 1st places, timed between the later of
 *   this Monday 00:00 UTC and January 1 00:00 UTC, and `now`. So they are in this week,
 *   in this calendar year, and never in the future, whatever weekday the seed runs;
 * - a rating_history row for last week for every player, so this week's sets have
 *   "start of week" ratings and some of them are upsets.
 */
import { EPOCH_MONDAY_MS, periodIndexFor, WEEK_MS } from "@sr/core";
import { and, gte, lt } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Database } from "./client";
import {
  events,
  ingestRuns,
  leaderboard,
  meta,
  players,
  ratingHistory,
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
const TOURNAMENT_CITIES = ["Austin", "Houston", "Dallas"];
const SETS_PER_EVENT = 45;

/**
 * This week's two events. Players are listed by index into TAG_WORDS (a lower index means a
 * higher seeded rating), and only players who are already ranked play, so ranks don't move.
 * `null` games is a DQ. A higher index beating a lower one is an upset.
 */
const WEEK_EVENTS = [
  {
    name: "Sample Weekly",
    city: "San Antonio",
    entrants: 24,
    at: 0.25,
    sets: [
      [7, 10, 3, 1], // Halo beats Kite
      [18, 11, 2, 1], // upset: Sage beats Lumen (gap 140)
      [12, 19, 2, 0], // Mako beats Tide
      [24, 13, null, null], // DQ: Yarrow "beats" Nova; never counted as an upset
      [7, 18, 3, 0], // Halo beats Sage in the final
    ],
    standings: [
      [7, 1],
      [18, 2],
      [12, 3],
      [10, 4],
      [11, 5],
      [19, 5],
      [13, 7],
      [24, 7],
    ],
  },
  {
    name: "Sample Arcadian",
    city: null, // start.gg may not report a city; the UI must cope
    entrants: 16,
    at: 0.5,
    sets: [
      [23, 21, 2, 1], // upset: Xeno beats Vex (gap 40)
      [22, 13, 3, 2], // upset: Wisp beats Nova (gap 180)
      [13, 19, 2, 0], // Nova beats Tide
      [22, 23, 3, 1], // Wisp beats Xeno
      [11, 13, 3, 1], // Lumen beats Nova
      [22, 11, 3, 2], // upset: Wisp beats Lumen in the final (gap 220)
    ],
    standings: [
      [22, 1],
      [11, 2],
      [13, 3],
      [23, 4],
      [21, 5],
      [19, 5],
    ],
  },
] as const;

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
    userSlug: word === "Dash" ? "user/sample-dash" : null, // one ranked player has a start.gg link for e2e
  }));
  // "This week" times: a fraction of the way from max(this Monday, January 1) to now.
  const period = periodIndexFor(now);
  const weekStartMs = EPOCH_MONDAY_MS + period * WEEK_MS;
  const windowStartMs = Math.max(weekStartMs, Date.UTC(now.getUTCFullYear(), 0, 1));
  const thisWeek = (fraction: number) =>
    new Date(windowStartMs + Math.floor((now.getTime() - windowStartMs) * fraction));

  const tournamentRows = [
    ...TOURNAMENT_NAMES.map((name, index) => ({
      id: id(index + 1),
      slug: `tournament/synthetic-${index + 1}`,
      name,
      startAt: new Date(now.getTime() - (3 - index) * 3 * WEEK_MS),
      city: TOURNAMENT_CITIES[index % TOURNAMENT_CITIES.length] ?? null,
      numAttendees: 32 + index * 32,
    })),
    ...WEEK_EVENTS.map((event, index) => ({
      id: id(TOURNAMENT_NAMES.length + index + 1),
      slug: `tournament/synthetic-${TOURNAMENT_NAMES.length + index + 1}`,
      name: event.name,
      startAt: thisWeek(event.at),
      city: event.city,
      numAttendees: event.entrants,
    })),
  ].map((tournament) => ({ ...tournament, countryCode: "US", region: "TX" }));
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

  const baseEvents = eventRows.slice(0, TOURNAMENT_NAMES.length);
  const setRows: (typeof sets.$inferInsert)[] = [];
  const setsPlayed = new Map<number, number>();
  const eventsPlayed = new Map<number, number>();
  for (const event of baseEvents) {
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
  const standingRows = baseEvents.flatMap((event) =>
    playerRows.map((player, index) => ({
      eventId: event.id,
      playerId: player.id,
      placement: index + 1,
    })),
  );
  for (const [index] of playerRows.entries()) eventsPlayed.set(index, baseEvents.length);

  WEEK_EVENTS.forEach((weekEvent, eventIndex) => {
    const event = eventRows[TOURNAMENT_NAMES.length + eventIndex];
    if (!event) throw new Error("seed: missing this-week event row");
    weekEvent.sets.forEach(([winner, loser, winnerGames, loserGames], index) => {
      const completedAt = thisWeek(weekEvent.at + (index + 1) * 0.02);
      const isDq = winnerGames === null;
      setRows.push({
        id: id(setRows.length + 1),
        eventId: event.id,
        winnerId: id(winner + 1),
        loserId: id(loser + 1),
        winnerGames,
        loserGames,
        isDq,
        completedAt,
        ratingPeriod: periodIndexFor(completedAt),
      });
      if (!isDq)
        for (const player of [winner, loser])
          setsPlayed.set(player, (setsPlayed.get(player) ?? 0) + 1);
    });
    for (const [player, placement] of weekEvent.standings) {
      standingRows.push({ eventId: event.id, playerId: id(player + 1), placement });
      eventsPlayed.set(player, (eventsPlayed.get(player) ?? 0) + 1);
    }
  });

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
      lastActiveAt: baseEvents.at(-1)?.startAt ?? now,
      eligible,
      countryCode: player.countryCode,
      setsPlayed: setsPlayed.get(index) ?? 0,
      eventsPlayed: eventsPlayed.get(index) ?? 0,
    };
  });
  // Last week's ratings: the "start of this week" ratings that decide what is an upset.
  const historyRows = leaderboardRows.map((row) => ({
    playerId: row.playerId,
    period: period - 1,
    rating: row.rating,
    rd: row.rd,
    volatility: 0.06,
    setsPlayed: 0,
  }));

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
    await tx.delete(ratingHistory).where(inRange(ratingHistory.playerId));
    await tx.delete(events).where(inRange(events.id));
    await tx.delete(tournaments).where(inRange(tournaments.id));
    await tx.delete(players).where(inRange(players.id));
    await tx.delete(ingestRuns).where(inRange(ingestRuns.id));

    await tx.insert(players).values(playerRows);
    await tx.insert(tournaments).values(tournamentRows);
    await tx.insert(events).values(eventRows);
    await tx.insert(sets).values(setRows);
    await tx.insert(standings).values(standingRows);
    await tx.insert(leaderboard).values(leaderboardRows);
    await tx.insert(ratingHistory).values(historyRows);
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
