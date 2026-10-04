import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createApiClient } from "@sr/api/client";
import {
  dashboardResponseSchema,
  leaderboardResponseSchema,
  metaResponseSchema,
  playerResponseSchema,
  searchResponseSchema,
  SEARCH_MAX_QUERY_LENGTH,
  statusResponseSchema,
  SEARCH_MIN_QUERY_LENGTH,
} from "@sr/core";
import { z } from "zod";
import { isDemoMode } from "./demoMode";

/** Data changes at most hourly, so five minutes of freshness is plenty. */
export const STALE_TIME_MS = 5 * 60 * 1000;

const apiUrlSchema = z.url();

/**
 * Base URL of the API (network mode only). Read lazily so a missing value shows the error state
 * instead of breaking the static build. `process.env.EXPO_PUBLIC_API_URL` must stay a literal read:
 * Expo inlines it. `pnpm dev` sets it explicitly; there is no hidden localhost fallback.
 */
export function getApiUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return apiUrlSchema.parse(configured);
  throw new Error("EXPO_PUBLIC_API_URL is not set");
}

let client: ReturnType<typeof createApiClient> | undefined;
const api = () => (client ??= createApiClient(getApiUrl()));

/** A non-2xx answer from the API. 4xx means the request itself was rejected, so retrying is pointless. */
export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API responded with ${status}`);
    this.name = "ApiError";
  }
}

async function readJson(response: {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}): Promise<unknown> {
  if (!response.ok) throw new ApiError(response.status);
  return response.json();
}

const queryDefaults = {
  staleTime: STALE_TIME_MS,
  retry: (failures: number, error: Error) =>
    failures < 1 && !(error instanceof ApiError && error.status < 500),
  retryDelay: 400,
} as const;

type Resource =
  | { name: "meta" | "dashboard" | "leaderboard" | "status" }
  | { name: "search"; query: string }
  | { name: "player"; playerId: string };

/**
 * The one data path. In demo mode it answers from the bundled sample data; otherwise from the
 * network. Both paths go through the same @sr/core schema. A player the API (or demo data) does
 * not know resolves to null so the page can say so. Callers parse the answer with the schema.
 */
async function load(resource: Resource): Promise<unknown> {
  if (isDemoMode()) {
    const { loadDemoData, searchDemoPlayers, findDemoPlayer } = await import("../demo/demoData");
    const data = await loadDemoData();
    switch (resource.name) {
      case "search":
        return searchDemoPlayers(data, resource.query);
      case "player":
        return findDemoPlayer(data, resource.playerId);
      default:
        return data[resource.name];
    }
  }
  const v1 = api().v1;
  switch (resource.name) {
    case "meta":
      return readJson(await v1.meta.$get());
    case "dashboard":
      return readJson(await v1.dashboard.$get());
    case "leaderboard":
      return readJson(await v1.leaderboard.$get({ query: {} }));
    case "status":
      return readJson(await v1.status.$get());
    case "search":
      return readJson(await v1.search.$get({ query: { q: resource.query } }));
    case "player": {
      const response = await v1.players[":id"].$get({ param: { id: resource.playerId } });
      return response.status === 404 ? null : readJson(response);
    }
  }
}

export const useLeaderboard = () =>
  useQuery({
    ...queryDefaults,
    queryKey: ["leaderboard"],
    queryFn: async () => leaderboardResponseSchema.parse(await load({ name: "leaderboard" })),
  });

export const useMeta = () =>
  useQuery({
    ...queryDefaults,
    queryKey: ["meta"],
    refetchInterval: 60_000,
    queryFn: async () => metaResponseSchema.parse(await load({ name: "meta" })),
  });

/** Job health changes minute to minute, so this one refetches every 60 s while the page is open. */
export const useStatus = () =>
  useQuery({
    ...queryDefaults,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryKey: ["status"],
    queryFn: async () => statusResponseSchema.parse(await load({ name: "status" })),
  });

/** `query` is already trimmed and lower-cased, so equal searches share one cache entry. */
export const useSearch = (query: string) =>
  useQuery({
    ...queryDefaults,
    queryKey: ["search", query],
    enabled: query.length >= SEARCH_MIN_QUERY_LENGTH && query.length <= SEARCH_MAX_QUERY_LENGTH,
    // Keep the old results on screen while the next search loads (no skeleton flicker).
    placeholderData: keepPreviousData,
    queryFn: async () => searchResponseSchema.parse(await load({ name: "search", query })),
  });

/** Resolves to null when the player does not exist (404), so the page can say so. */
export const usePlayer = (playerId: string | null) =>
  useQuery({
    ...queryDefaults,
    queryKey: ["player", playerId],
    enabled: playerId !== null,
    queryFn: async () => {
      const body = await load({ name: "player", playerId: playerId ?? "" });
      return body === null ? null : playerResponseSchema.parse(body);
    },
  });

/** Everything on the Dashboard tab comes from one call (the API caches it at the edge). */
export const useDashboard = () =>
  useQuery({
    ...queryDefaults,
    queryKey: ["dashboard"],
    queryFn: async () => dashboardResponseSchema.parse(await load({ name: "dashboard" })),
  });
