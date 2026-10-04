/*
 * Vercel Function entry. `pnpm --filter @sr/api build` (scripts/build-vercel.mjs) bundles this file
 * and every workspace package it imports into .vercel/output/functions/api.func/index.mjs, in
 * Vercel's Build Output API format. Every path is routed to this one function; the request keeps
 * its original URL, so Hono routes on /v1/... as usual.
 *
 * Vercel's Node launcher calls the default export as a plain Node (req, res) handler, and
 * getRequestListener turns that into a standard Request for Hono and writes the Response back.
 */
import { getRequestListener } from "@hono/node-server";
import { app } from "./server";

export default getRequestListener(app.fetch);
