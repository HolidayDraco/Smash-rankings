// Manual only, never from tests or CI. Needs STARTGG_TOKEN and network access to api.start.gg.
//   pnpm live:check [-- --out report.md] [--record] [--max-requests 25] [--event <id>]
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv, MissingEnvError } from "@sr/core";
import { createStartggClient } from "../src/client";
import { parseLiveCheckArgs, renderReport, runLiveCheck, scrubRecorded } from "../src/live-check";

function stop(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

let args: ReturnType<typeof parseLiveCheckArgs>;
try {
  args = parseLiveCheckArgs(process.argv.slice(2));
} catch (error) {
  stop(`Bad arguments: ${error instanceof Error ? error.message : String(error)}`, 1);
}

let token: string;
try {
  token = loadEnv(["STARTGG_TOKEN"]).STARTGG_TOKEN;
} catch (error) {
  console.error(error instanceof MissingEnvError ? error.message : "STARTGG_TOKEN is not set.");
  stop("Create a token at start.gg > Settings > Developer Settings, then export STARTGG_TOKEN.", 1);
}

const redact = (text: string) => text.split(token).join("[redacted]");
const recorded: Record<string, unknown> = {};
// Few retries, so the request cap is close to real (25 plus at most 2 retries of the last call).
const client = createStartggClient({ token, maxAttempts: 3 });
try {
  const result = await runLiveCheck(client, {
    budget: args.maxRequests,
    eventId: args.event,
    redact,
    onRaw: (name, data) => {
      recorded[name] ??= scrubRecorded(data);
    },
  });
  const report = redact(renderReport(result));
  process.stdout.write(report);
  // pnpm runs scripts inside the package folder; INIT_CWD is where the command was typed.
  if (args.out) writeFileSync(resolve(process.env["INIT_CWD"] ?? process.cwd(), args.out), report);
  if (args.record) {
    const dir = new URL("../fixtures/live/", import.meta.url);
    mkdirSync(dir, { recursive: true });
    for (const [name, data] of Object.entries(recorded)) {
      writeFileSync(new URL(`${name}.json`, dir), `${JSON.stringify(data, null, 2)}\n`);
    }
    console.error(`Recorded ${Object.keys(recorded).length} scrubbed responses in fixtures/live/.`);
  }
  process.exit(result.errors.length > 0 ? 2 : 0);
} catch (error) {
  stop(`Live check crashed: ${redact(error instanceof Error ? error.message : String(error))}`, 2);
}
