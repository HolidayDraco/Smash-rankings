import {
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MAX_RESULTS,
  SEARCH_MIN_QUERY_LENGTH,
  searchResponseSchema,
  type PlayerResponse,
  type SearchResponse,
} from "@sr/core";
import { demoDataSchema, type DemoData } from "./schema";

let loaded: Promise<DemoData> | undefined;

/** Loads and validates the bundled snapshot once. A dynamic import keeps it out of real-API builds' first load. */
export function loadDemoData(): Promise<DemoData> {
  return (loaded ??= import("./data.json").then((module) => demoDataSchema.parse(module.default)));
}

/** Answers a search the way the API does: case-insensitive "contains" on the tag, ranked first. */
export function searchDemoPlayers(data: DemoData, rawQuery: string): SearchResponse {
  const query = rawQuery.trim().toLowerCase();
  if (query.length < SEARCH_MIN_QUERY_LENGTH || query.length > SEARCH_MAX_QUERY_LENGTH) {
    throw new RangeError("Invalid q");
  }
  const results = Object.values(data.players)
    .filter((player) => player.gamerTag.toLowerCase().includes(query))
    .map(({ playerId, gamerTag, prefix, rank }) => ({ playerId, gamerTag, prefix, rank }))
    .sort(
      (a, b) =>
        (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
        a.gamerTag.toLowerCase().localeCompare(b.gamerTag.toLowerCase()) ||
        Number(a.playerId) - Number(b.playerId),
    )
    .slice(0, SEARCH_MAX_RESULTS);
  return searchResponseSchema.parse({ query, results, attribution: data.meta.attribution });
}

/** The demo player, or null for an id we don't have (the page then says "Player not found"). */
export function findDemoPlayer(data: DemoData, playerId: string): PlayerResponse | null {
  return Object.hasOwn(data.players, playerId) ? (data.players[playerId] ?? null) : null;
}
