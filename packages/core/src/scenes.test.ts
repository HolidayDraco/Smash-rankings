import { describe, expect, it } from "vitest";
import { scenesFileSchema } from "./scenes";
import { texasScenes } from "./texas-scenes";
import raw from "../../../data/scenes/texas.json";

const scene = (over: Record<string, unknown> = {}) => ({
  id: "sampletown",
  city: "Sampletown",
  rankingName: "PR",
  season: "2026",
  sourceUrl: "https://example.com/x",
  type: "official",
  updated: "2026-09-20",
  players: [
    { rank: 1, name: "A" },
    { rank: 2, name: "B" },
  ],
  ...over,
});
const file = (scenes: unknown[]) => ({ version: 1, updated: "2026-10-03", scenes });

describe("scenesFileSchema", () => {
  it("accepts the real data file", () => {
    expect(scenesFileSchema.safeParse(raw).success).toBe(true);
    expect(texasScenes.scenes.map((s) => s.city)).toEqual([
      "Austin",
      "Dallas-Fort Worth",
      "Houston",
      "Rio Grande Valley",
      "San Antonio",
    ]);
  });
  it("accepts a null source link and varying player counts", () => {
    const ok = file([scene({ sourceUrl: null }), scene({ id: "b", city: "Other", players: [] })]);
    expect(scenesFileSchema.safeParse(ok).success).toBe(true);
  });
  it("rejects ranks that skip, repeat or start wrong", () => {
    for (const ranks of [
      [1, 3],
      [1, 1],
      [2, 3],
      [2, 1],
    ]) {
      const players = ranks.map((rank) => ({ rank, name: "P" }));
      expect(scenesFileSchema.safeParse(file([scene({ players })])).success).toBe(false);
    }
  });
  it("accepts HM entries after the numbered ranks, in any number, and optional scene dates", () => {
    const players = [
      { rank: 1, name: "PSG | Rubric" },
      { rank: "HM", name: "Ekoh / Khmaster69" },
      { rank: "HM", name: "Other" },
    ];
    const { updated: _omit, ...noDate } = scene({ players });
    expect(scenesFileSchema.safeParse(file([noDate])).success).toBe(true);
  });
  it("rejects HM before a numbered rank", () => {
    const players = [
      { rank: 1, name: "A" },
      { rank: "HM", name: "B" },
      { rank: 2, name: "C" },
    ];
    expect(scenesFileSchema.safeParse(file([scene({ players })])).success).toBe(false);
  });
  it("rejects other string ranks and unknown types", () => {
    const players = [{ rank: "1", name: "A" }];
    expect(scenesFileSchema.safeParse(file([scene({ players })])).success).toBe(false);
    expect(scenesFileSchema.safeParse(file([scene({ type: "voted" })])).success).toBe(false);
    expect(scenesFileSchema.safeParse(file([scene({ type: undefined })])).success).toBe(false);
  });
  it("keeps names exactly as given", () => {
    const players = [{ rank: 1, name: " gold_ship_ / nadia_ " }];
    const parsed = scenesFileSchema.parse(file([scene({ players })]));
    expect(parsed.scenes[0]?.players[0]?.name).toBe(" gold_ship_ / nadia_ ");
  });
  it("rejects empty player names", () => {
    const players = [{ rank: 1, name: "  " }];
    expect(scenesFileSchema.safeParse(file([scene({ players })])).success).toBe(false);
  });
  it("rejects duplicate ids", () => {
    expect(scenesFileSchema.safeParse(file([scene(), scene()])).success).toBe(false);
  });
  it("rejects non-https links", () => {
    for (const sourceUrl of ["http://example.com/x", "javascript:alert(1)", "not a url"]) {
      expect(scenesFileSchema.safeParse(file([scene({ sourceUrl })])).success).toBe(false);
    }
  });
  it("rejects bad dates and versions", () => {
    expect(scenesFileSchema.safeParse(file([scene({ updated: "9/20/2026" })])).success).toBe(false);
    expect(scenesFileSchema.safeParse({ ...file([]), version: 2 }).success).toBe(false);
  });

  it("rejects unknown keys such as a misspelled optional field", () => {
    expect(scenesFileSchema.safeParse(file([scene({ upated: "2026-09-20" })])).success).toBe(false);
    const players = [{ rank: 1, name: "A", nmae: "x" }];
    expect(scenesFileSchema.safeParse(file([scene({ players })])).success).toBe(false);
    expect(scenesFileSchema.safeParse({ ...file([scene()]), extra: 1 }).success).toBe(false);
  });
  it("rejects duplicate city names, ignoring case", () => {
    const dupes = file([scene(), scene({ id: "other", city: "sampletown" })]);
    expect(scenesFileSchema.safeParse(dupes).success).toBe(false);
  });
  describe("CC BY-SA credit", () => {
    const credit = {
      site: "Liquipedia",
      license: "CC BY-SA",
    };
    it("requires credit for liquipedia.net and ssbwiki.com sources", () => {
      for (const sourceUrl of [
        "https://liquipedia.net/smash/Texas_Power_Rankings/Austin",
        "https://www.ssbwiki.com/Texas_Power_Rankings/Houston_Power_Rankings",
      ]) {
        expect(scenesFileSchema.safeParse(file([scene({ sourceUrl })])).success).toBe(false);
        expect(scenesFileSchema.safeParse(file([scene({ sourceUrl, credit })])).success).toBe(true);
      }
    });
    it("does not require credit for other sources, and checks the credit shape", () => {
      expect(scenesFileSchema.safeParse(file([scene({ credit })])).success).toBe(true);
      for (const licenseUrl of [
        "http://creativecommons.org/licenses/by-sa/3.0/",
        "https://liquipedia.net/smash/Texas_Power_Rankings",
      ]) {
        const bad = { ...credit, licenseUrl };
        expect(scenesFileSchema.safeParse(file([scene({ credit: bad })])).success).toBe(false);
      }
      const versioned = {
        ...credit,
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
      };
      expect(scenesFileSchema.safeParse(file([scene({ credit: versioned })])).success).toBe(true);
      const wrong = { ...credit, license: "MIT" };
      expect(scenesFileSchema.safeParse(file([scene({ credit: wrong })])).success).toBe(false);
    });
    it("has credit on the three wiki-sourced real scenes only", () => {
      const credited = texasScenes.scenes.filter((s) => s.credit).map((s) => s.city);
      expect(credited).toEqual(["Austin", "Dallas-Fort Worth", "Houston"]);
    });
  });
});
