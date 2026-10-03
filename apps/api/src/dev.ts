/* Local dev server (`pnpm dev`): the same app as production, on Node's HTTP server. */
import { serve } from "@hono/node-server";
import { app } from "./server";

const port = 8787;
serve({ fetch: app.fetch, port }, () => {
  console.log(`API listening on http://localhost:${port}`);
});
