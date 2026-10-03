import { describe, expect, it } from "vitest";
import { isInLaunchRegion } from "./region";
import { classifyEvent, isOnlineEvent, isSinglesEvent, type EventFacts } from "./qualifying";

const base: EventFacts = {
  videogameId: 1386,
  numEntrants: 16,
  type: 1,
  teamRosterSize: null,
  isOnline: false,
  tournamentCountryCode: "US",
  tournamentAddrState: "TX",
};

describe("classifyEvent", () => {
  it("qualifies in-person Texas Ultimate singles with exactly 16 entrants", () => {
    expect(classifyEvent(base)).toBe("qualifies");
  });
  it("skips 15 entrants", () => {
    expect(classifyEvent({ ...base, numEntrants: 15 })).toBe("skip");
  });
  it("skips unknown entrant counts", () => {
    expect(classifyEvent({ ...base, numEntrants: null })).toBe("skip");
  });
  it("stores (but does not qualify) online Texas-tagged events with 16 or more entrants", () => {
    expect(classifyEvent({ ...base, isOnline: true })).toBe("stored-not-qualifying");
  });
  it("skips online events with fewer than 16 entrants", () => {
    expect(classifyEvent({ ...base, isOnline: true, numEntrants: 15 })).toBe("skip");
  });
  it("skips online events with no state", () => {
    const online = { ...base, isOnline: true, tournamentAddrState: null };
    expect(classifyEvent(online)).toBe("skip");
  });
  it("skips events outside the launch region, however large", () => {
    expect(classifyEvent({ ...base, numEntrants: 500, tournamentAddrState: "CA" })).toBe("skip");
    expect(classifyEvent({ ...base, tournamentCountryCode: "CA" })).toBe("skip");
  });
  it("skips events whose location is unknown", () => {
    expect(classifyEvent({ ...base, tournamentCountryCode: null, tournamentAddrState: null })).toBe(
      "skip",
    );
    const { tournamentCountryCode: _c, tournamentAddrState: _s, ...noLocation } = base;
    expect(classifyEvent(noLocation)).toBe("skip");
  });
  it("accepts the full state name and a missing country", () => {
    expect(classifyEvent({ ...base, tournamentAddrState: "Texas" })).toBe("qualifies");
    expect(classifyEvent({ ...base, tournamentCountryCode: null })).toBe("qualifies");
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

describe("isInLaunchRegion", () => {
  const where = (countryCode: string | null, addrState: string | null) =>
    isInLaunchRegion({ countryCode, addrState });
  it("matches the code and the full name, ignoring case and padding", () => {
    for (const state of ["TX", "tx", "Texas", "TEXAS", " tx "]) {
      expect(where("US", state)).toBe(true);
    }
  });
  it("relies on the state alone when the country is null", () => {
    expect(where(null, "TX")).toBe(true);
    expect(where(null, "CA")).toBe(false);
  });
  it("is false for a non-US country, even with a Texas-looking state", () => {
    expect(where("CA", "TX")).toBe(false);
    expect(where("MX", "Texas")).toBe(false);
  });
  it("is false for other states and for no state", () => {
    expect(where("US", "CA")).toBe(false);
    expect(where("US", "Oklahoma")).toBe(false);
    expect(where("US", null)).toBe(false);
    expect(where(null, null)).toBe(false);
  });
  it("adding a state is a config change", () => {
    const region = { countryCode: "US", states: ["TX", "OK"] };
    expect(isInLaunchRegion({ countryCode: "US", addrState: "ok" }, region)).toBe(true);
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
