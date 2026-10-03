import { describe, expect, it } from "vitest";
import { periodIndexFor } from "./rating-period";

describe("periodIndexFor", () => {
  it("starts weeks on Monday 1970-01-05 UTC", () => {
    expect(periodIndexFor(new Date("1970-01-05T00:00:00Z"))).toBe(0);
    expect(periodIndexFor(new Date("1970-01-11T23:59:59Z"))).toBe(0);
    expect(periodIndexFor(new Date("1970-01-12T00:00:00Z"))).toBe(1);
    expect(periodIndexFor(new Date("1970-01-04T23:59:59Z"))).toBe(-1);
  });
  it("matches the formula and the known example", () => {
    const date = new Date("2026-10-03T12:00:00Z");
    expect(periodIndexFor(date)).toBe(
      Math.floor((date.getTime() - Date.UTC(1970, 0, 5)) / 604800000),
    );
    expect(periodIndexFor(date)).toBe(2960);
  });
});
