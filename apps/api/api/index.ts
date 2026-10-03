/*
 * Vercel Function entry. vercel.json rewrites every path here; the request
 * keeps its original URL, so Hono routes on /v1/... as usual. Vercel's Node
 * runtime accepts Web-standard (Request) => Response handlers per method.
 */
import { app } from "../src/server";

const handler = (request: Request): Response | Promise<Response> => app.fetch(request);

export const GET = handler;
export const HEAD = handler;
export const OPTIONS = handler;
