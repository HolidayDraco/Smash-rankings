import { describe, expect, it } from "vitest";
import type { PlayerRating } from "./glicko2";
import type { PeriodSet } from "./history";
import {
  buildLeaderboard,
  conservativeScore,
  eligibilityStats,
  isEligible,
  rankLeaderboard,
} from "./leaderboard";

describe("conservativeScore", () => {
  it("is r − 2·RD", () => {
    expect(conservativeScore({ rating: 1800, ratingDeviation: 60 })).toBe(1680);
  });
});

describe("isEligible", () => {
  const ok = { ratedSets: 10, qualifyingEvents: 3, ratingDeviation: 110 };

  it("accepts players exactly at every threshold", () => {
    expect(isEligible(ok)).toBe(true);
  });

  it("rejects players just below any threshold", () => {
    expect(isEligible({ ...ok, ratedSets: 9 })).toBe(false);
    expect(isEligible({ ...ok, qualifyingEvents: 2 })).toBe(false);
    expect(isEligible({ ...ok, ratingDeviation: 110.0001 })).toBe(false);
  });

  it("accepts custom rules", () => {
    const rules = { minRatedSets: 1, minQualifyingEvents: 1, maxRatingDeviation: 350 };
    expect(isEligible({ ratedSets: 1, qualifyingEvents: 1, ratingDeviation: 300 }, rules)).toBe(
      true,
    );
  });
});

describe("rankLeaderboard", () => {
  it("sorts by conservative score, then rating, then player id", () => {
    const ranked = rankLeaderboard([
      { playerId: "c", rating: 1700, ratingDeviation: 50 }, // 1600
      { playerId: "b", rating: 1800, ratingDeviation: 100 }, // 1600, higher rating
      { playerId: "a", rating: 1700, ratingDeviation: 50 }, // 1600, ties c, lower id
      { playerId: "d", rating: 2000, ratingDeviation: 150 }, // 1700
    ]);
    expect(ranked.map((e) => [e.rank, e.playerId])).toEqual([
      [1, "d"],
      [2, "b"],
      [3, "a"],
      [4, "c"],
    ]);
    expect(ranked[0]?.conservativeScore).toBe(1700);
  });

  it("gives the same order for any input order", () => {
    const entries = [
      { playerId: "x", rating: 1600, ratingDeviation: 50 },
      { playerId: "y", rating: 1600, ratingDeviation: 50 },
      { playerId: "z", rating: 1650, ratingDeviation: 75 },
    ];
    const forward = rankLeaderboard(entries).map((e) => e.playerId);
    expect(rankLeaderboard([...entries].reverse()).map((e) => e.playerId)).toEqual(forward);
  });

  it("breaks ties by the lower start.gg id as a number, not as text", () => {
    const tied = (playerId: string) => ({ playerId, rating: 1600, ratingDeviation: 50 });
    const ranked = rankLeaderboard(["100", "99", "1000", "9", "abc"].map(tied));
    // Text order would be "100", "1000", "9", "99"; digit-only ids come before other ids.
    expect(ranked.map((e) => e.playerId)).toEqual(["9", "99", "100", "1000", "abc"]);
  });

  it("rejects duplicate player ids", () => {
    const entry = { playerId: "x", rating: 1500, ratingDeviation: 50 };
    expect(() => rankLeaderboard([entry, entry])).toThrow(/duplicate/);
  });
});

/** `count` sets won by `playerId`, spread round-robin over `events` events in week `period`. */
const wins = (playerId: string, count: number, events: number, period = 100): PeriodSet[] =>
  Array.from({ length: count }, (_, i) => ({
    winnerId: playerId,
    loserId: `opp${i}`,
    period,
    eventId: `${playerId}-ev${i % events}`,
  }));

const rated = (rating: number, ratingDeviation: number): PlayerRating => ({
  rating,
  ratingDeviation,
  volatility: 0.06,
});

describe("eligibilityStats", () => {
  it("counts non-DQ sets and distinct events in the trailing window only", () => {
    const sets: PeriodSet[] = [
      ...wins("p", 3, 3, 48), // week 48: just outside a 52-week window ending at 100
      ...wins("p", 4, 2, 49), // week 49: first week inside the window
      { winnerId: "p", loserId: "q", period: 100, eventId: "dq", isDq: true },
      { winnerId: "p", loserId: "q", period: 101, eventId: "future" },
    ];
    const stats = eligibilityStats({
      sets,
      asOfPeriod: 100,
      standingsEvents: [{ playerId: "p", eventId: "dq", period: 100 }],
    });
    expect(stats.get("p")).toEqual({ ratedSets: 4, qualifyingEvents: 3, lastActivePeriod: 49 });
    expect(stats.has("q")).toBe(false);
  });

  it("rejects a trailing window shorter than one week", () => {
    expect(() => eligibilityStats({ sets: [], asOfPeriod: 100, trailingWeeks: 0 })).toThrow(
      RangeError,
    );
  });

  it("counts an event attended only through DQs (from standings) toward the event total", () => {
    const stats = eligibilityStats({
      sets: [...wins("p", 10, 2), { ...wins("p", 1, 1)[0]!, eventId: "dq-only", isDq: true }],
      standingsEvents: [{ playerId: "p", eventId: "dq-only", period: 100 }],
      asOfPeriod: 100,
    });
    expect(stats.get("p")).toMatchObject({ ratedSets: 10, qualifyingEvents: 3 });
  });

  it("merges aliases before counting", () => {
    const stats = eligibilityStats({
      sets: [
        ...wins("alt", 2, 2),
        ...wins("main", 2, 1),
        { ...wins("alt", 1, 1)[0]!, loserId: "main" },
      ],
      asOfPeriod: 100,
      aliases: new Map([["alt", "main"]]),
    });
    expect(stats.get("main")).toEqual({ ratedSets: 4, qualifyingEvents: 3, lastActivePeriod: 100 });
    expect(stats.has("alt")).toBe(false);
  });
});

describe("buildLeaderboard", () => {
  const eligibleOf = (sets: PeriodSet[], rd: number): boolean => {
    const stats = eligibilityStats({ sets, asOfPeriod: 100 });
    const [row] = buildLeaderboard({ ratings: new Map([["p", rated(1800, rd)]]), stats });
    return row?.eligible === true && row.rank === 1;
  };

  it("ranks a player exactly at every threshold", () => {
    expect(eligibleOf(wins("p", 10, 3), 110)).toBe(true);
  });

  it("does not rank a 9-set player", () => {
    expect(eligibleOf(wins("p", 9, 3), 60)).toBe(false);
  });

  it("does not rank a player with only 2 events", () => {
    expect(eligibleOf(wins("p", 20, 2), 60)).toBe(false);
  });

  it("does not rank a player with RD 111", () => {
    expect(eligibleOf(wins("p", 20, 3), 111)).toBe(false);
  });

  it("ranks eligible players first, then lists unranked players with rank null", () => {
    const enough = { ratedSets: 10, qualifyingEvents: 3, lastActivePeriod: 1 };
    const rows = buildLeaderboard({
      ratings: new Map([
        ["new", rated(2000, 300)],
        ["b", rated(1700, 50)],
        ["a", rated(1700, 50)],
      ]),
      stats: new Map([
        ["a", enough],
        ["b", enough],
      ]),
    });
    expect(rows.map((row) => [row.playerId, row.rank, row.eligible])).toEqual([
      ["a", 1, true],
      ["b", 2, true],
      ["new", null, false],
    ]);
    expect(rows[2]).toMatchObject({ ratedSets: 0, qualifyingEvents: 0, lastActivePeriod: null });
    expect(rows[0]?.conservativeScore).toBe(1600);
  });

  it("computes the 7-day rank change: up, down, new, and dropped", () => {
    const enough = { ratedSets: 10, qualifyingEvents: 3, lastActivePeriod: 1 };
    const rows = buildLeaderboard({
      ratings: new Map([
        ["riser", rated(1900, 50)], // now #1, was #3
        ["faller", rated(1800, 50)], // now #2, was #1
        ["newcomer", rated(1700, 50)], // now #3, unranked before
        ["dropped", rated(1600, 150)], // was #2, RD too high now
      ]),
      stats: new Map(["riser", "faller", "newcomer", "dropped"].map((id) => [id, enough])),
      previousRanks: new Map<string, number | null>([
        ["faller", 1],
        ["dropped", 2],
        ["riser", 3],
        ["newcomer", null],
      ]),
    });
    expect(rows.map((row) => [row.playerId, row.rank, row.rankDelta7d])).toEqual([
      ["riser", 1, 2],
      ["faller", 2, -1],
      ["newcomer", 3, null],
      ["dropped", null, null],
    ]);
  });
});
