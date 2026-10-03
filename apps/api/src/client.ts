/* Typed API client for the app (Hono RPC): `createApiClient(url).v1.leaderboard.$get(...)`. */
import { hc, type ClientRequestOptions } from "hono/client";
import type { AppType } from "./app";

export const createApiClient = (baseUrl: string, options?: ClientRequestOptions) =>
  hc<AppType>(baseUrl, options);
export type ApiClient = ReturnType<typeof createApiClient>;
