import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createApiClient } from "@sr/api/client";
import {
  leaderboardResponseSchema,
  metaResponseSchema,
  searchResponseSchema,
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MIN_QUERY_LENGTH,
} from "@sr/core";
import { z } from "zod";

/** Data changes at most hourly, so five minutes of freshness is plenty. */
export const STALE_TIME_MS = 5 * 60 * 1000;

const apiUrlSchema = z.url();

/**
 * Base URL of the API. Read lazily so a missing value shows the error state instead of breaking
 * the static build. `process.env.EXPO_PUBLIC_API_URL` must stay a literal read: Expo inlines it.
 */
export function getApiUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return apiUrlSchema.parse(configured);
  if (__DEV__) return "http://localhost:8787";
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

export const useLeaderboard = () =>
  useQuery({
    ...queryDefaults,
    queryKey: ["leaderboard"],
    queryFn: async () =>
      leaderboardResponseSchema.parse(
        await readJson(await api().v1.leaderboard.$get({ query: {} })),
      ),
  });

export const useMeta = () =>
  useQuery({
    ...queryDefaults,
    queryKey: ["meta"],
    refetchInterval: 60_000,
    queryFn: async () => metaResponseSchema.parse(await readJson(await api().v1.meta.$get())),
  });

/** `query` is already trimmed and lower-cased, so equal searches share one cache entry. */
export const useSearch = (query: string) =>
  useQuery({
    ...queryDefaults,
    queryKey: ["search", query],
    enabled: query.length >= SEARCH_MIN_QUERY_LENGTH && query.length <= SEARCH_MAX_QUERY_LENGTH,
    // Keep the old results on screen while the next search loads (no skeleton flicker).
    placeholderData: keepPreviousData,
    queryFn: async () =>
      searchResponseSchema.parse(
        await readJson(await api().v1.search.$get({ query: { q: query } })),
      ),
  });
