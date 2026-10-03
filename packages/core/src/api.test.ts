import { describe, expect, it } from "vitest";
import { dashboardMoverSchema, dashboardWeekEventSchema, playerResponseSchema } from "./api";

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

describe("dashboard rows", () => {
  const player = { rank: 1, playerId: "1", gamerTag: "A", prefix: null };
  it("a mover must have moved", () => {
    expect(dashboardMoverSchema.safeParse({ ...player, rankDelta7d: 2 }).success).toBe(true);
    expect(dashboardMoverSchema.safeParse({ ...player, rankDelta7d: -1 }).success).toBe(true);
    expect(dashboardMoverSchema.safeParse({ ...player, rankDelta7d: 0 }).success).toBe(false);
    expect(dashboardMoverSchema.safeParse({ ...player, rankDelta7d: null }).success).toBe(false);
  });
  it("week events only link to https www.start.gg", () => {
    const event = {
      eventId: "1",
      eventName: "Singles",
      tournamentName: "T",
      city: null,
      startAt: "2026-09-28T00:00:00.000Z",
      numEntrants: null,
      winner: null,
      startggUrl: "https://www.start.gg/tournament/t/event/singles",
    };
    expect(dashboardWeekEventSchema.safeParse(event).success).toBe(true);
    for (const startggUrl of ["http://www.start.gg/t", "https://evil.example/t", "javascript:x"]) {
      expect(dashboardWeekEventSchema.safeParse({ ...event, startggUrl }).success).toBe(false);
    }
  });
});
