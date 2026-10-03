// Manual only: replaces schema/startgg.graphql with the live schema. Needs STARTGG_TOKEN.
// Goes through the shared client so the limiter, auth handling, and token redaction still apply.
import { writeFile } from "node:fs/promises";
import { buildClientSchema, getIntrospectionQuery, printSchema } from "graphql";
import { loadEnv } from "@sr/core";
import { createStartggClient, STARTGG_ENDPOINT } from "../src/client";

const { STARTGG_TOKEN } = loadEnv(["STARTGG_TOKEN"]);
const client = createStartggClient({ token: STARTGG_TOKEN });
const data = (await client.rawQuery("Introspection", getIntrospectionQuery())) as Parameters<
  typeof buildClientSchema
>[0];
const header = `# Pulled by schema:pull from ${STARTGG_ENDPOINT} on ${new Date().toISOString()}.\n\n`;
await writeFile(
  new URL("../schema/startgg.graphql", import.meta.url),
  header + printSchema(buildClientSchema(data)) + "\n",
);
console.log("Wrote schema/startgg.graphql. Now run: pnpm codegen");
