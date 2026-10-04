import { describe, expect, it } from "vitest";
import {
  dashboardWindow,
  formatSetScore,
  isoDate,
  lastDayOfWeek,
  startggUrlFor,
} from "./dashboard";

describe("dashboardWindow", () => {
  it("runs from Monday 00:00 UTC to the next Monday 00:00 (exclusive)", () => {
    const window = dashboardWindow(new Date("2026-10-03T12:00:00Z")); // a Saturday
    expect(window.weekStart.toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(window.weekEnd.toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(lastDayOfWeek(window.weekEnd)).toBe("2026-10-04");
    expect(window.year).toBe(2026);
    expect(window.yearStart.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("puts Monday 00:00 in the new week and Sunday 23:59:59.999 in the old one", () => {
    const monday = dashboardWindow(new Date("2026-09-28T00:00:00.000Z"));
    const sunday = dashboardWindow(new Date("2026-09-27T23:59:59.999Z"));
    expect(isoDate(monday.weekStart)).toBe("2026-09-28");
    expect(isoDate(sunday.weekStart)).toBe("2026-09-21");
    expect(monday.period).toBe(sunday.period + 1);
  });

  it("uses the UTC calendar year, even when the week started last year", () => {
    const window = dashboardWindow(new Date("2027-01-01T00:30:00Z")); // a Friday
    expect(window.year).toBe(2027);
    expect(isoDate(window.weekStart)).toBe("2026-12-28");
    expect(window.yearStart.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("rejects an invalid date", () => {
    expect(() => dashboardWindow(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe("formatSetScore", () => {
  it("formats known game counts and returns null otherwise", () => {
    expect(formatSetScore(3, 1)).toBe("3-1");
    expect(formatSetScore(2, 0)).toBe("2-0");
    expect(formatSetScore(null, 0)).toBeNull();
    expect(formatSetScore(2, null)).toBeNull();
    expect(formatSetScore(-1, 2)).toBeNull();
    expect(formatSetScore(1.5, 0)).toBeNull();
  });
});

describe("startggUrlFor", () => {
  it("builds a www.start.gg link from a slug", () => {
    expect(startggUrlFor("tournament/a/event/b")).toBe("https://www.start.gg/tournament/a/event/b");
  });
});
