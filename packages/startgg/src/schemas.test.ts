import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tournamentsDataSchema } from "./schemas";

const load = () =>
  JSON.parse(
    readFileSync(new URL("../fixtures/tournaments-page-1.json", import.meta.url), "utf8"),
  ) as { data: { tournaments: { nodes: Record<string, unknown>[] } } };

const firstCity = (data: unknown) =>
  tournamentsDataSchema.parse(data).tournaments?.nodes?.[0]?.city;

describe("tournament city", () => {
  it("keeps a city string from the fixture", () => {
    expect(firstCity(load().data)).toBe("Austin");
  });

  it("accepts a null city and keeps it null", () => {
    const body = load();
    (body.data.tournaments.nodes[0] ?? {})["city"] = null;
    expect(firstCity(body.data)).toBeNull();
  });
});
