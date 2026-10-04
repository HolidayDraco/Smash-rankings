import { describe, expect, it } from "vitest";
import {
  describeNotRanked,
  describeUpset,
  formatEventDay,
  formatSetScore,
  formatWeekRange,
  moreEventsText,
  weekDeltaSpoken,
  weekDeltaText,
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
      "Needs more sets for the rating to settle.",
    );
  });
});

describe("week delta", () => {
  it("shows arrows, a dash for no change, and NEW", () => {
    expect(weekDeltaText(2)).toBe("▲2");
    expect(weekDeltaText(-1)).toBe("▼1");
    expect(weekDeltaText(0)).toBe("—");
    expect(weekDeltaText(null)).toBe("NEW");
  });
  it("speaks them in words", () => {
    expect(weekDeltaSpoken(2)).toBe("up 2");
    expect(weekDeltaSpoken(-1)).toBe("down 1");
    expect(weekDeltaSpoken(0)).toBe("no change");
    expect(weekDeltaSpoken(null)).toBe("new");
  });
});

describe("dashboard text", () => {
  it("formats the week range in UTC", () =>
    expect(formatWeekRange("2026-09-28", "2026-10-04")).toBe("Week of Mon Sep 28 – Sun Oct 4"));
  it("crosses a year boundary", () =>
    expect(formatWeekRange("2026-12-28", "2027-01-03")).toBe("Week of Mon Dec 28 – Sun Jan 3"));
  it("formats an event day in UTC", () =>
    expect(formatEventDay("2026-10-03T23:30:00.000Z")).toBe("Sat Oct 3"));
  it("shows the event day in Texas time, not UTC", () => {
    // 8:30 pm Tuesday in Texas is 01:30 Wednesday UTC.
    expect(formatEventDay("2026-09-30T01:30:00.000Z")).toBe("Tue Sep 29");
    expect(formatEventDay("2026-09-30T01:30:00.000Z", "UTC")).toBe("Wed Sep 30");
  });
  it("says 'and N more' only when events were cut off", () => {
    expect(moreEventsText(23, 20)).toBe("and 3 more");
    expect(moreEventsText(20, 20)).toBeNull();
    expect(moreEventsText(0, 0)).toBeNull();
  });
  it("uses an en dash in scores", () => expect(formatSetScore("3-1")).toBe("3–1"));
  it("writes an upset as a sentence", () => {
    expect(describeUpset("Sample_Halo", "Sample_Kite", "3-1")).toBe(
      "Sample_Halo beat Sample_Kite 3–1",
    );
    expect(describeUpset("A", "B", null)).toBe("A beat B");
  });
});
