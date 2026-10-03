import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  isoWeekToPeriodIndex,
  periodIndexFor,
  periodIndexToIsoWeek,
  periodStart,
  ratingPeriodFor,
  ratingWindow,
} from "./period";

const at = (iso: string): string => ratingPeriodFor(new Date(iso));

describe("ratingPeriodFor", () => {
  it("returns the ISO week id", () => {
    expect(at("2026-10-03T12:00:00Z")).toBe("2026-W40");
    expect(at("2026-03-02T00:00:00Z")).toBe("2026-W10");
  });

  it("splits weeks at Monday 00:00 UTC", () => {
    expect(at("2026-10-04T23:59:59.999Z")).toBe("2026-W40");
    expect(at("2026-10-05T00:00:00Z")).toBe("2026-W41");
  });

  it("uses UTC, not local offsets", () => {
    // Sunday 20:00 in New York is already Monday 00:00 UTC.
    expect(at("2026-10-04T20:00:00-04:00")).toBe("2026-W41");
  });

  it("handles year boundaries", () => {
    expect(at("2024-12-30T00:00:00Z")).toBe("2025-W01");
    expect(at("2021-01-03T23:59:59Z")).toBe("2020-W53");
    expect(at("2021-01-04T00:00:00Z")).toBe("2021-W01");
    expect(at("2026-12-31T12:00:00Z")).toBe("2026-W53");
    expect(at("2027-01-03T12:00:00Z")).toBe("2026-W53");
    expect(at("2027-01-04T00:00:00Z")).toBe("2027-W01");
  });

  it("rejects invalid dates", () => {
    expect(() => ratingPeriodFor(new Date("nope"))).toThrow(RangeError);
  });
});

describe("integer period index", () => {
  it("counts weeks from Monday 1970-01-05 UTC", () => {
    expect(periodIndexFor(new Date("1970-01-05T00:00:00Z"))).toBe(0);
    expect(periodIndexFor(new Date("1970-01-04T23:59:59Z"))).toBe(-1);
    expect(periodIndexFor(new Date("2026-10-03T12:00:00Z"))).toBe(2960);
    expect(periodIndexToIsoWeek(2960)).toBe("2026-W40");
    expect(isoWeekToPeriodIndex("2026-W40")).toBe(2960);
    expect(isoWeekToPeriodIndex("2020-W53")).toBe(isoWeekToPeriodIndex("2021-W01") - 1);
  });

  it("rejects malformed or non-existent weeks", () => {
    expect(() => isoWeekToPeriodIndex("2026-40")).toThrow(RangeError);
    expect(() => isoWeekToPeriodIndex("2026-W00")).toThrow(RangeError);
    expect(() => isoWeekToPeriodIndex("2025-W53")).toThrow(RangeError);
    expect(() => periodIndexFor(new Date("nope"))).toThrow(RangeError);
  });

  const anyDate = fc.date({
    min: new Date("1990-01-01T00:00:00Z"),
    max: new Date("2100-01-01T00:00:00Z"),
    noInvalidDate: true,
  });

  it("agrees with ratingPeriodFor and round-trips (property)", () => {
    fc.assert(
      fc.property(anyDate, (date) => {
        const period = periodIndexFor(date);
        expect(periodIndexToIsoWeek(period)).toBe(ratingPeriodFor(date));
        expect(isoWeekToPeriodIndex(ratingPeriodFor(date))).toBe(period);
        expect(periodStart(period).getTime()).toBeLessThanOrEqual(date.getTime());
      }),
    );
  });

  it("consecutive weeks differ by exactly 1 (property)", () => {
    fc.assert(
      fc.property(anyDate, (date) => {
        const nextWeek = new Date(date.getTime() + 7 * 86_400_000);
        expect(periodIndexFor(nextWeek) - periodIndexFor(date)).toBe(1);
        expect(ratingPeriodFor(nextWeek)).not.toBe(ratingPeriodFor(date));
      }),
    );
  });
});

describe("ratingWindow", () => {
  it("covers the 52 weeks ending at the as-of period, inclusive", () => {
    expect(ratingWindow(100)).toEqual({ fromPeriod: 49, toPeriod: 100 });
    expect(ratingWindow(100, 1)).toEqual({ fromPeriod: 100, toPeriod: 100 });
  });

  it("rejects windows shorter than one week and non-integers", () => {
    expect(() => ratingWindow(100, 0)).toThrow(RangeError);
    expect(() => ratingWindow(100, -3)).toThrow(RangeError);
    expect(() => ratingWindow(1.5)).toThrow(RangeError);
  });
});
