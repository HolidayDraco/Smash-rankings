import { describe, expect, it } from "vitest";
import { colors, contrastRatio, textPairs } from "./colors";

describe("contrast", () => {
  it("computes known WCAG ratios", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("uses a white page background", () => {
    expect(colors.white).toBe("#FFFFFF");
  });

  it.each(textPairs.map((p) => [p.name, p] as const))("%s is at least 4.5:1", (_name, pair) => {
    expect(contrastRatio(colors[pair.foreground], colors[pair.background])).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});
