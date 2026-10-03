# Fixtures

All files here are **synthetic**: they are shaped like real start.gg responses but use made-up
ids and gamer tags. Each has a `_note` key. Tests use them and never call the live API.

- `tournaments-page-*.json`: two pages, with a doubles event (type 5) to filter out
- `sets-page-*.json`: two pages, including a DQ set (7002, displayScore "DQ", score -1; encoding is a guess until verified live)
- `standings-page-1.json`: final placements
- `error-rate-limit.json`, `error-complexity.json`: error bodies

Re-record with a real token (manual only): `STARTGG_TOKEN=... pnpm --filter @sr/startgg fixtures:record`.
