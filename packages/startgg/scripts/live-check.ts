// Manual only, never from tests or CI. Needs STARTGG_TOKEN and network access to api.start.gg.
//   pnpm live:check [-- --out report.md] [--record] [--max-requests 25]
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadEnv, MissingEnvError } from "@sr/core";
import { createStartggClient } from "../src/client";
import {
  DEFAULT_LIVE_CHECK_BUDGET,
  renderReport,
  runLiveCheck,
  scrubRecorded,
} from "../src/live-check";

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    record: { type: "boolean", default: false },
    "max-requests": { type: "string", default: String(DEFAULT_LIVE_CHECK_BUDGET) },
  },
});

let token: string;
try {
  token = loadEnv(["STARTGG_TOKEN"]).STARTGG_TOKEN;
} catch (error) {
  console.error(error instanceof MissingEnvError ? error.message : "STARTGG_TOKEN is not set.");
  console.error(
    "Create a token at start.gg > Settings > Developer Settings, then export STARTGG_TOKEN.",
  );
  process.exit(1);
}

const recorded: Record<string, unknown> = {};
const client = createStartggClient({ token });
const result = await runLiveCheck(client, {
  budget: Number(values["max-requests"]),
  onRaw: (name, data) => {
    recorded[name] ??= scrubRecorded(data);
  },
});
const report = renderReport(result);
process.stdout.write(report);
if (values.out) writeFileSync(values.out, report);
if (values.record) {
  const dir = new URL("../fixtures/live/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(recorded)) {
    writeFileSync(new URL(`${name}.json`, dir), `${JSON.stringify(data, null, 2)}\n`);
  }
  console.error(`Recorded ${Object.keys(recorded).length} scrubbed responses in fixtures/live/.`);
}
process.exit(result.errors.length > 0 ? 2 : 0);
