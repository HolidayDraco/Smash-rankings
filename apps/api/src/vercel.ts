/*
 * Vercel Function entry. `pnpm --filter @sr/api build` bundles this file (and
 * every workspace package it imports) into api/index.js with esbuild, because
 * Vercel's Node runtime only transpiles and can't resolve our raw-.ts
 * workspace exports. vercel.json rewrites every path to /api; the request keeps
 * its original URL, so Hono routes on /v1/... as usual.
 */
import { app } from "./server";

const handler = (request: Request): Response | Promise<Response> => app.fetch(request);

export const GET = handler;
export const HEAD = handler;
export const OPTIONS = handler;
