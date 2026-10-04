import { describe, expect, it } from "vitest";
import { isNewVersion, parseBuildId, shouldCheckVersion } from "./buildVersion";

describe("isNewVersion", () => {
  it("is true only when both ids are known and differ", () => {
    expect(isNewVersion("abc", "def")).toBe(true);
    expect(isNewVersion("abc", "abc")).toBe(false);
  });
  it("is false when the embedded id is unknown (dev) or the remote is unusable", () => {
    expect(isNewVersion(undefined, "def")).toBe(false);
    expect(isNewVersion("abc", undefined)).toBe(false);
    expect(isNewVersion("abc", "")).toBe(false);
    expect(isNewVersion("abc", 5)).toBe(false);
  });
});

describe("shouldCheckVersion", () => {
  it("checks the first time, then at most once per interval", () => {
    expect(shouldCheckVersion(null, 1000)).toBe(true);
    expect(shouldCheckVersion(1000, 1000 + 299_999)).toBe(false);
    expect(shouldCheckVersion(1000, 1000 + 300_000)).toBe(true);
    expect(shouldCheckVersion(1000, 1500, 100)).toBe(true);
  });
});

describe("parseBuildId", () => {
  it("reads a good body and rejects bad shapes", () => {
    expect(parseBuildId({ buildId: "abc" })).toBe("abc");
    expect(parseBuildId({ buildId: "" })).toBeUndefined();
    expect(parseBuildId({})).toBeUndefined();
    expect(parseBuildId(null)).toBeUndefined();
    expect(parseBuildId("x")).toBeUndefined();
  });
});
