import { describe, expect, it } from "vitest";
import { classifyEvent, isOnlineEvent, isSinglesEvent, type EventFacts } from "./qualifying";

const base: EventFacts = {
  videogameId: 1386,
  numEntrants: 64,
  type: 1,
  teamRosterSize: null,
  isOnline: false,
};

describe("classifyEvent", () => {
  it("qualifies in-person Ultimate singles with exactly 64 entrants", () => {
    expect(classifyEvent(base)).toBe("qualifies");
  });
  it("skips 63 entrants", () => {
    expect(classifyEvent({ ...base, numEntrants: 63 })).toBe("skip");
  });
  it("skips unknown entrant counts", () => {
    expect(classifyEvent({ ...base, numEntrants: null })).toBe("skip");
  });
  it("stores (but does not qualify) online events with 64 or more entrants", () => {
    expect(classifyEvent({ ...base, isOnline: true })).toBe("stored-not-qualifying");
  });
  it("skips online events with fewer than 64 entrants", () => {
    expect(classifyEvent({ ...base, isOnline: true, numEntrants: 63 })).toBe("skip");
  });
  it("skips doubles even when large", () => {
    const doubles = { ...base, numEntrants: 200, type: 5, teamRosterSize: { maxPlayers: 2 } };
    expect(classifyEvent(doubles)).toBe("skip");
  });
  it("skips other games", () => {
    expect(classifyEvent({ ...base, videogameId: 1 })).toBe("skip");
    expect(classifyEvent({ ...base, videogameId: null })).toBe("skip");
  });
});

describe("isSinglesEvent", () => {
  it("uses type when present", () => {
    expect(isSinglesEvent({ type: 1, teamRosterSize: null })).toBe(true);
    expect(isSinglesEvent({ type: 5, teamRosterSize: null })).toBe(false);
  });
  it("falls back to team roster size", () => {
    expect(isSinglesEvent({ type: null, teamRosterSize: null })).toBe(true);
    expect(isSinglesEvent({ type: null, teamRosterSize: { maxPlayers: 1 } })).toBe(true);
    expect(isSinglesEvent({ type: null, teamRosterSize: { maxPlayers: 2 } })).toBe(false);
  });
});

describe("isOnlineEvent", () => {
  it("prefers the event flag, then the tournament flag, then in person", () => {
    expect(isOnlineEvent({ isOnline: true, tournamentIsOnline: false })).toBe(true);
    expect(isOnlineEvent({ isOnline: false, tournamentIsOnline: true })).toBe(false);
    expect(isOnlineEvent({ isOnline: null, tournamentIsOnline: true })).toBe(true);
    expect(isOnlineEvent({ isOnline: null })).toBe(false);
  });
});
