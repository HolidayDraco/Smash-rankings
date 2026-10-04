// Builds the API for Vercel in its Build Output API format (v3):
//
//   .vercel/output/config.json                    routing: every path goes to the one function
//   .vercel/output/functions/api.func/index.mjs   the whole API bundled into one file by esbuild
//   .vercel/output/functions/api.func/.vc-config.json
//
// Vercel deploys a prebuilt .vercel/output as-is, so the project needs no "public" folder, no
// framework preset, and no source files are ever served. We bundle (instead of letting Vercel's
// Node runtime transpile src/) because our workspace packages export raw .ts files.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const outputDir = ".vercel/output";
const functionDir = join(outputDir, "functions", "api.func");

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(functionDir, { recursive: true });

await build({
  entryPoints: ["src/vercel.ts"],
  outfile: join(functionDir, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "info",
});

const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

writeJson(join(functionDir, ".vc-config.json"), {
  runtime: "nodejs22.x",
  handler: "index.mjs",
  launcherType: "Nodejs",
  shouldAddHelpers: false,
});

// The request keeps its original URL, so Hono still routes on /, /v1/..., etc.
writeJson(join(outputDir, "config.json"), {
  version: 3,
  routes: [{ src: "/(.*)", dest: "/api" }],
});

console.log(`Wrote ${outputDir} (one function: /api)`);
