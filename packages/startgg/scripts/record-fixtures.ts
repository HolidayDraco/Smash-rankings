export {};
// Manual only. Same as `live:check --record`: runs the live check and saves scrubbed raw
// responses under fixtures/live/. Never run from tests or CI.
process.argv.push("--record");
await import("./live-check");
