import { describe, expect, it } from "vitest";
import type { Scene } from "@sr/core";
import { arrangeScenes, parsePins, togglePin } from "./scenes";

const make = (id: string, city: string): Scene => ({
  id,
  city,
  rankingName: "PR",
  season: "2026",
  sourceUrl: null,
  type: "official",
  players: [],
});
const scenes = [
  make("d", "Dallas"),
  make("a", "austin"),
  make("h", "Houston"),
  make("e", "El Paso"),
];
const cities = (list: Scene[]) => list.map((s) => s.city);

describe("arrangeScenes", () => {
  it("sorts alphabetically ignoring case", () => {
    expect(cities(arrangeScenes(scenes, new Set(), ""))).toEqual([
      "austin",
      "Dallas",
      "El Paso",
      "Houston",
    ]);
  });
  it("puts pinned cities first, alphabetical within each group", () => {
    expect(cities(arrangeScenes(scenes, new Set(["h", "e"]), ""))).toEqual([
      "El Paso",
      "Houston",
      "austin",
      "Dallas",
    ]);
  });
  it("filters by city substring, case-insensitive and trimmed", () => {
    expect(cities(arrangeScenes(scenes, new Set(), "  AS "))).toEqual(["Dallas", "El Paso"]);
    expect(cities(arrangeScenes(scenes, new Set(), "ous"))).toEqual(["Houston"]);
    expect(arrangeScenes(scenes, new Set(), "zzz")).toEqual([]);
  });
  it("keeps pins first within filtered results and does not mutate input", () => {
    const copy = [...scenes];
    expect(cities(arrangeScenes(scenes, new Set(["h"]), "o"))).toEqual(["Houston", "El Paso"]);
    expect(scenes).toEqual(copy);
  });
});

describe("togglePin", () => {
  it("adds and removes without mutating", () => {
    const empty = new Set<string>();
    const one = togglePin(empty, "a");
    expect([...one]).toEqual(["a"]);
    expect(empty.size).toBe(0);
    expect(togglePin(one, "a").size).toBe(0);
  });
});

describe("parsePins", () => {
  it("reads known ids only", () => {
    expect([...parsePins('["a","zzz",3]', ["a", "d"])]).toEqual(["a"]);
  });
  it("survives missing or malformed data", () => {
    expect(parsePins(null, ["a"]).size).toBe(0);
    expect(parsePins("{oops", ["a"]).size).toBe(0);
    expect(parsePins('{"a":1}', ["a"]).size).toBe(0);
  });
});
