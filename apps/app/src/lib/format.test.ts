import { describe, expect, it } from "vitest";
import {
  describeNotRanked,
  formatPlacement,
  ordinal,
  parsePlayerId,
  playerHref,
  relativeTime,
  slugify,
} from "./format";

describe("slugify", () => {
  it("lowercases and joins words", () => expect(slugify("Sample_Ace")).toBe("sample-ace"));
  it("strips accents and symbols", () => expect(slugify("Léo ★ Z")).toBe("leo-z"));
  it("falls back when nothing is left", () => expect(slugify("★★")).toBe("player"));
});

describe("playerHref", () => {
  it("is one segment: id then slug", () =>
    expect(playerHref("42", "Sample_Ace")).toBe("/player/42-sample-ace"));
});

describe("relativeTime", () => {
  const now = Date.parse("2026-10-03T12:00:00Z");
  it("handles minutes, hours, and days", () => {
    expect(relativeTime("2026-10-03T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-10-03T11:55:00Z", now)).toBe("5 min ago");
    expect(relativeTime("2026-10-03T09:00:00Z", now)).toBe("3 h ago");
    expect(relativeTime("2026-09-30T12:00:00Z", now)).toBe("3 days ago");
  });
});

describe("player page helpers", () => {
  it("parses the id before the first dash and rejects bad ids", () => {
    expect(parsePlayerId("1234-sample-ace")).toBe("1234");
    expect(parsePlayerId("77")).toBe("77");
    for (const bad of ["abc", "0-x", "-5", "", "12a-x", "1234567890123456-x"])
      expect(parsePlayerId(bad)).toBeNull();
    expect(parsePlayerId(undefined)).toBeNull();
  });
  it("formats ordinals and placements", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 112].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "101st",
      "112th",
    ]);
    expect(formatPlacement(4, 128)).toBe("4th of 128");
    expect(formatPlacement(4, null)).toBe("4th");
  });
  it("explains why a player is not ranked", () => {
    expect(describeNotRanked({ setsNeeded: 1, eventsNeeded: 2, uncertaintyTooHigh: false })).toBe(
      "Needs 1 more rated set and 2 more events.",
    );
    expect(describeNotRanked({ setsNeeded: 0, eventsNeeded: 0, uncertaintyTooHigh: true })).toBe(
      "Rating still uncertain; plays more to settle.",
    );
  });
});
