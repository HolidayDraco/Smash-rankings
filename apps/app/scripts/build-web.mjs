// Wrapper for `expo export -p web`: picks a build id, embeds it in the bundle (EXPO_PUBLIC_BUILD_ID)
// and writes the same id to <output dir>/build-id.json so the running app can notice a new deploy.
// Needs no env vars. Extra arguments (--clear, --output-dir X) pass straight through to expo.
// The output folder is read from `--output-dir X`, `--output-dir=X` or `-o X`.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function gitShortSha() {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA?.trim() || gitShortSha() || `t${Date.now().toString(36)}`;

const args = process.argv.slice(2);
function outputDirArg() {
  for (const [index, arg] of args.entries()) {
    if (arg.startsWith("--output-dir=")) return arg.slice("--output-dir=".length);
    if (arg === "--output-dir" || arg === "-o") return args[index + 1];
  }
  return undefined;
}
const outputDir = resolve(outputDirArg() || "dist");

const expo = spawnSync("pnpm", ["exec", "expo", "export", "-p", "web", ...args], {
  stdio: "inherit",
  env: { ...process.env, EXPO_PUBLIC_BUILD_ID: buildId },
});
if (expo.status !== 0) process.exit(expo.status ?? 1);

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, "build-id.json"), JSON.stringify({ buildId }) + "\n");
console.log(`build id ${buildId} -> ${join(outputDir, "build-id.json")}`);
