import { describe, expect, it } from "vitest";
import {
  LEADERBOARD_ELIGIBILITY,
  QUALIFYING_EVENT_RULES,
  ULTIMATE_VIDEOGAME_ID,
} from "./constants";

describe("locked product constants", () => {
  it("targets Super Smash Bros. Ultimate", () => {
    expect(ULTIMATE_VIDEOGAME_ID).toBe(1386);
  });

  it("matches blueprint decisions 2 and 3", () => {
    expect(QUALIFYING_EVENT_RULES).toEqual({
      minEntrants: 64,
      allowOnline: false,
      singlesOnly: true,
    });
  });

  it("matches the ADR-0002 eligibility defaults", () => {
    expect(LEADERBOARD_ELIGIBILITY.minRatedSets).toBe(10);
    expect(LEADERBOARD_ELIGIBILITY.minQualifyingEvents).toBe(3);
    expect(LEADERBOARD_ELIGIBILITY.maxRatingDeviation).toBe(110);
  });
});
