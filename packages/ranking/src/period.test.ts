import { describe, expect, it } from "vitest";
import { ratingPeriodFor } from "./period";

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
