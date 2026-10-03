import { describe, expect, it } from "vitest";
import { playerHref, relativeTime, slugify } from "./format";

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
