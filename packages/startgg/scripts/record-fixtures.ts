// STUB, manual only. Never run from tests or CI.
// Intended: with a real STARTGG_TOKEN, run each query once through createStartggClient
// against a small known event, scrub fields we do not store, and overwrite fixtures/*.json.
import { loadEnv } from "@sr/core";

loadEnv(["STARTGG_TOKEN"]);
console.error(
  "fixtures:record is not implemented yet. Record by hand with one live query per document in src/queries, then scrub and save under fixtures/.",
);
process.exit(1);
