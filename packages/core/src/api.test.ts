import { describe, expect, it } from "vitest";
import { playerResponseSchema } from "./api";

const base = {
  playerId: "1",
  gamerTag: "A",
  prefix: null,
  countryCode: null,
  startggUrl: null as string | null,
  rank: null,
  eligible: false,
  notRankedReason: null,
  conservativeScore: null,
  rating: null,
  ratingDeviation: null,
  ratedSets: 0,
  qualifyingEvents: 0,
  setRecord: { wins: 0, losses: 0 },
  recentResults: [],
  attribution: "Data from start.gg",
};

describe("player startggUrl", () => {
  it("accepts null and https www.start.gg links", () => {
    expect(playerResponseSchema.safeParse(base).success).toBe(true);
    const ok = { ...base, startggUrl: "https://www.start.gg/user/abc123" };
    expect(playerResponseSchema.safeParse(ok).success).toBe(true);
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,hi",
    "http://www.start.gg/user/a",
    "https://evil.example/user/a",
    "https://start.gg.evil.example/user/a",
  ])("rejects %s", (url) => {
    expect(playerResponseSchema.safeParse({ ...base, startggUrl: url }).success).toBe(false);
  });
});
