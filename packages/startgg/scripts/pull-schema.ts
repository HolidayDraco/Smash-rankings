// Manual only: replaces schema/startgg.graphql with the live schema. Needs STARTGG_TOKEN.
// This is the one place besides the client that talks to start.gg, run by a human, not by tests.
import { writeFile } from "node:fs/promises";
import { buildClientSchema, getIntrospectionQuery, printSchema } from "graphql";
import { loadEnv } from "@sr/core";
import { STARTGG_ENDPOINT } from "../src/client";

const { STARTGG_TOKEN } = loadEnv(["STARTGG_TOKEN"]);
const response = await fetch(STARTGG_ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${STARTGG_TOKEN}` },
  body: JSON.stringify({ query: getIntrospectionQuery() }),
});
if (!response.ok) throw new Error(`Introspection failed: HTTP ${response.status}`);
const { data } = (await response.json()) as { data: Parameters<typeof buildClientSchema>[0] };
const header = `# Pulled by schema:pull from ${STARTGG_ENDPOINT} on ${new Date().toISOString()}.\n\n`;
await writeFile(
  new URL("../schema/startgg.graphql", import.meta.url),
  header + printSchema(buildClientSchema(data)) + "\n",
);
console.log("Wrote schema/startgg.graphql. Now run: pnpm codegen");
