import { describe, expect, it } from "vitest";
import {
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MAX_RESULTS,
  dashboardResponseSchema,
  leaderboardResponseSchema,
  metaResponseSchema,
  playerResponseSchema,
  searchResponseSchema,
  statusResponseSchema,
} from "@sr/core";
import raw from "./data.json";
import { findDemoPlayer, loadDemoData, searchDemoPlayers } from "./demoData";
import { demoDataSchema } from "./schema";

describe("demo snapshot (src/demo/data.json)", () => {
  // A stale or hand-edited snapshot fails here. Regenerate: see STATUS.md or scripts/snapshot-demo-data.mts.
  it("passes the same schemas as the real API", () => {
    expect(() => demoDataSchema.parse(raw)).not.toThrow();
  });

  it("answers every endpoint with its own schema", async () => {
    const data = await loadDemoData();
    expect(() => metaResponseSchema.parse(data.meta)).not.toThrow();
    expect(() => dashboardResponseSchema.parse(data.dashboard)).not.toThrow();
    expect(() => leaderboardResponseSchema.parse(data.leaderboard)).not.toThrow();
    expect(() => statusResponseSchema.parse(data.status)).not.toThrow();
    for (const player of Object.values(data.players)) {
      expect(() => playerResponseSchema.parse(player)).not.toThrow();
    }
  });

  it("is only synthetic Sample_* players", async () => {
    const data = await loadDemoData();
    const players = Object.values(data.players);
    expect(players.length).toBeGreaterThan(5);
    expect(players.every((player) => player.gamerTag.startsWith("Sample_"))).toBe(true);
  });

  it("links no sample player to a start.gg profile, and has only Sample tournaments", async () => {
    const data = await loadDemoData();
    expect(Object.values(data.players).every((player) => player.startggUrl === null)).toBe(true);
    const tournaments = data.dashboard.weekEvents.map((event) => event.tournamentName);
    expect(tournaments.every((name) => name.startsWith("Sample "))).toBe(true);
  });

  it("has a player page for every leaderboard and dashboard player", async () => {
    const data = await loadDemoData();
    for (const entry of data.leaderboard.entries) {
      expect(findDemoPlayer(data, entry.playerId)?.gamerTag).toBe(entry.gamerTag);
    }
    for (const entry of data.dashboard.top10) {
      expect(findDemoPlayer(data, entry.playerId)).not.toBeNull();
    }
  });
});

describe("demo search and player lookup", () => {
  it("matches case-insensitively anywhere in the tag, and trims", async () => {
    const data = await loadDemoData();
    const found = searchDemoPlayers(data, "  SAMPLE_  ");
    expect(() => searchResponseSchema.parse(found)).not.toThrow();
    expect(found.query).toBe("sample_");
    expect(found.results.length).toBe(
      Math.min(SEARCH_MAX_RESULTS, Object.keys(data.players).length),
    );
    const [first] = Object.values(data.players);
    const middle = (first?.gamerTag ?? "").slice(3, 9).toUpperCase();
    expect(searchDemoPlayers(data, middle).results.map((r) => r.playerId)).toContain(
      first?.playerId,
    );
  });

  it("lists ranked players first, in rank order", async () => {
    const data = await loadDemoData();
    const ranks = searchDemoPlayers(data, "sample").results.map((r) => r.rank ?? Infinity);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("returns an empty list when nothing matches, and rejects bad query lengths", async () => {
    const data = await loadDemoData();
    expect(searchDemoPlayers(data, "zzzzzz").results).toEqual([]);
    expect(() => searchDemoPlayers(data, "a")).toThrow(RangeError);
    expect(() => searchDemoPlayers(data, "x".repeat(SEARCH_MAX_QUERY_LENGTH + 1))).toThrow(
      RangeError,
    );
  });

  it("returns null for an unknown player id", async () => {
    const data = await loadDemoData();
    expect(findDemoPlayer(data, "999")).toBeNull();
    expect(findDemoPlayer(data, "not-a-number")).toBeNull();
    expect(findDemoPlayer(data, "constructor")).toBeNull();
  });
});
