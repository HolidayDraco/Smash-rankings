// Smoke test for the Vercel build: loads the bundled function the way Vercel's Node launcher does
// (default export as a Node (req, res) handler), sends GET / and checks the health answer.
// Also checks the routing file sends every path to the function. Run after `pnpm --filter @sr/api build`.
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const output = new URL("../.vercel/output/", import.meta.url);
const fail = (message) => {
  console.error(`check-vercel-output: ${message}`);
  process.exit(1);
};

const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, output), "utf8"));
const config = readJson("config.json");
if (config.version !== 3 || config.routes?.[0]?.dest !== "/api")
  fail("config.json routing is wrong");
const vcConfig = readJson("functions/api.func/.vc-config.json");
if (vcConfig.launcherType !== "Nodejs" || vcConfig.handler !== "index.mjs") {
  fail(".vc-config.json is wrong");
}

// Only the function is deployed: a static folder could publish files by accident.
if (existsSync(new URL("static", output))) fail("unexpected static/ folder in the output");

const handlerPath = fileURLToPath(new URL("functions/api.func/index.mjs", output));
const { default: handler } = await import(handlerPath);
if (typeof handler !== "function") fail("the function has no default export");

const server = createServer(handler);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
try {
  const response = await fetch(`http://127.0.0.1:${address.port}/`);
  const body = await response.json();
  if (response.status !== 200 || body.ok !== true) fail(`GET / answered ${response.status}`);
  const head = await fetch(`http://127.0.0.1:${address.port}/`, { method: "HEAD" });
  if (head.status !== 200) fail(`HEAD / answered ${head.status}`);
  const missing = await fetch(`http://127.0.0.1:${address.port}/nope`);
  if (missing.status !== 404) fail(`GET /nope answered ${missing.status}, expected 404`);
  console.log("check-vercel-output: ok (GET and HEAD / answer 200, unknown paths 404)");
} finally {
  server.close();
}
