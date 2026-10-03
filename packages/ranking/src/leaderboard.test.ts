import { describe, expect, it } from "vitest";
import { conservativeScore, isEligible, rankLeaderboard } from "./leaderboard";

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

  it("rejects duplicate player ids", () => {
    const entry = { playerId: "x", rating: 1500, ratingDeviation: 50 };
    expect(() => rankLeaderboard([entry, entry])).toThrow(/duplicate/);
  });
});
