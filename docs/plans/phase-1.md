# Phase 1 plan: MVP web

**Status:** Planned, October 3, 2026 (architect subagent)
**Goal (plain English):** Pull the last 12 months of in-person Ultimate singles events with 64 or more entrants from start.gg, rate every player with Glicko-2, and show the results on a fast website. The site has a top-100 leaderboard with search, player pages, a methodology page, a status page, start.gg attribution, and error monitoring.

## Ground rules (same as Phase 0)

- **Locked decisions:** blueprint decisions 1–8 (8 = white light theme). They are used as-is.
- **Merge policy:** Claude self-merges when CI is green, `code-reviewer` says "Ready", and every comment from Clay or Genghis has a reply. There are no approval stops.
- **Evidence:** a CI link and test counts on every PR. UI PRs also include screenshots at 390 px and 1280 px under `docs/screenshots/<branch>/`, until Vercel is connected and previews take over.
- **Data during development:** start.gg is mocked with fixtures, and the database is a throwaway Postgres. UI and API tests use a **synthetic seed** (`pnpm db:seed`) with made-up player names, so no real personal data sits in the repo.
- **Live data** begins only after Clay's setup steps (`docs/plans/phase-0.md`). Code PRs do not wait for it. Scheduled jobs skip with a clear "not configured yet" notice while secrets are missing, so CI doesn't go red every day.
- **Always:** ≤ 60 start.gg requests/min through `packages/startgg`, and all ingestion workflows share one `concurrency` group so the token is never used twice at once. Minimum data. **No bulk export:** list endpoints cap at 100 rows. "Data from start.gg" appears on every data screen. $0 on free tiers.

## Order and dependencies

Backend first: P1-1 → P1-2 → P1-3. P1-4 can run in parallel with P1-1 through P1-3. P1-5 needs P1-2 and P1-4. P1-6 → P1-7 need P1-5's tables (they test with the synthetic seed). Screens follow: P1-8 → P1-9 → P1-10. P1-11 (Sentry) can land any time after P1-6. P1-12 runs once Clay's secrets exist.

---

### P1-1 · Qualifying rules and the discover job
- **Branch:** `feat/job-discover` · **Builder:** startgg-ingestion
- **Scope:** `packages/core/qualifying.ts` (Ultimate 1386, singles, ≥ 64 entrants, in person → `qualifies = true`; online events with ≥ 64 entrants are stored with `qualifies = false`; smaller events are not stored, per the minimum-data rule). Also `jobs/` as package `@sr/jobs` with a shared CLI harness (`--dry-run`, a time budget, and an `ingest_runs` writer), and `jobs/discover.ts` (window: last 14 days plus next 30 days; `--from`/`--to` for backfill).
- **Tests (fixtures + throwaway Postgres):** a 63-entrant event is skipped. A doubles event is skipped. An online event is stored but marked non-qualifying. Running twice creates no duplicates. A dry run writes nothing. One `ingest_runs` row is written with `requests_used`.
- **Risks:** the online and singles signals are "pending live check" (see `docs/startgg-notes.md`). Each is isolated in one function so a fix is a one-line change.
- ☐ The PR lists the "which events count" rules in plain English, and they match decisions 2 and 3
- ☐ The PR shows a dry-run printout like "12 events found, 7 qualify"
- ☐ CI is green with the new tests listed
- ☐ The PR states the expected start.gg requests per daily run (target ≤ 50)

### P1-2 · Sync job: sets, standings, players
- **Branch:** `feat/job-sync` · **Builder:** startgg-ingestion
- **Scope:** `jobs/sync.ts`: pages through each qualifying event's sets and standings, maps entrants to start.gg player ids, and upserts the minimal `players` fields (tag, prefix, location if verified). It marks DQs (`is_dq`), assigns `rating_period` with a shared ISO-week helper in `packages/core`, checkpoints `events.sync_cursor` after each page, stops cleanly before the time budget, and re-syncs completed events once about 48 hours later.
- **Tests:** pages through to the end, resumes from a saved cursor, stores a DQ set as `is_dq = true`, retries after a mid-run rate-limit error, shrinks pages after a complexity error, saves a partial cursor when the time budget runs out, and creates no duplicates on rerun. Entrants without a start.gg player account are skipped and counted.
- **Risks:** DQ encoding is unverified. It sits in one tested function and is fixed in P1-12 if needed.
- ☐ The PR shows a test named for DQ handling, passing
- ☐ The PR shows a test proving a stopped run picks up where it left off
- ☐ The PR lists exactly which player fields are stored (minimum data)
- ☐ CI is green

### P1-3 · Backfill (12 months) and the ingest workflow
- **Branch:** `feat/ingest-workflows` · **Builder:** startgg-ingestion
- **Scope:** `jobs/backfill.ts` (walks back month by month, `--months` default 12, checkpoint stored in `meta`). Also `.github/workflows/ingest.yml`: discover daily at `17 9 * * *`; sync at `23 */2 * * *` plus `23 * * * 5,6,0,1`; backfill nightly at `41 7 * * *` plus `workflow_dispatch` with a `months` input. It uses one shared `concurrency` group, `timeout-minutes`, secrets from Actions only, and skips when secrets are missing. Each run logs the DB size, with a warning at 70% of 1 GB. actionlint runs in CI.
- **Tests:** backfill resumes from its checkpoint. A dry run reports the request count. actionlint passes.
- **Risks:** a 12-month backfill takes hours, so it spreads over several nightly runs (≤ 5 h each, under the 6 h job limit [GH3]). An auth failure fails the run loudly.
- ☐ The PR explains the schedule in plain words ("every 2 hours, hourly Fri–Mon")
- ☐ The PR shows the estimated requests and hours for the 12-month backfill
- ☐ The PR confirms jobs never overlap (one shared queue)
- ☐ CI is green, including the workflow check

### P1-4 · Rating history, eligibility, and leaderboard builder (pure)
- **Branch:** `feat/ranking-eligibility` · **Builder:** ranking-engine
- **Scope:** `packages/ranking`: `rateHistory(sets, fromPeriod, toPeriod)` walks weekly periods (sets only, DQs dropped, merged aliases resolved to the main player). `isEligible` (≥ 10 sets, ≥ 3 qualifying events, trailing 12 months from a passed-in "as of" date, RD ≤ 110). `buildLeaderboard` sorts by `conservativeScore` descending, with ties broken by rating and then player id. `rankDelta7d`. Thresholds live in `packages/core`.
- **Tests:** a 9-set player is not eligible. A player with 2 events is not eligible. An RD of 111 is not eligible. Ties sort the same way every time. Inactive weeks inflate RD. The same input always gives the same output.
- ☐ The PR explains "conservative score = rating minus two times uncertainty" in one sentence
- ☐ The PR shows the eligibility tests passing
- ☐ The Glickman example test still passes
- ☐ CI is green

### P1-5 · Rate job and METHODOLOGY.md
- **Branch:** `feat/job-rate` · **Builder:** ranking-engine
- **Scope:** `jobs/rate.ts` does a full recompute over the 12-month window. That's simple and deterministic; incremental recompute comes later only if runtime needs it. The current week is rated with the sets so far and redone each run. The job writes `rating_history`, fills `leaderboard_staging`, swaps it in one transaction, bumps `meta.data_version` and `last_rated_at`, writes the top 20 to the GitHub job summary, and logs `ingest_runs`. `ingest.yml` triggers rate after a successful sync or backfill (`workflow_run`). Also includes the first draft of `docs/METHODOLOGY.md` (fan-friendly).
- **Tests (synthetic seed):** a rerun gives an identical leaderboard. A reader during the swap sees the old or new table, never empty. `data_version` goes up. Runtime is reported.
- ☐ METHODOLOGY.md reads in plain language: what counts, how scores work, and their limits
- ☐ The PR shows a sample top-20 table from the synthetic data
- ☐ The PR states the job's runtime
- ☐ CI is green

### P1-6 · API skeleton: meta and status
- **Branch:** `feat/api-skeleton` · **Builder:** lead session, with qa-tester for tests
- **Scope:** `apps/api` (Hono on Vercel Functions, env checked at startup), response schemas in `packages/core`, a cache middleware (`public, s-maxage=300, stale-while-revalidate=86400`), CORS for the app's domains, and `attribution: "Data from start.gg"` on every response. Routes: `GET /v1/meta` (data_version, last_rated_at) and `GET /v1/status` (latest run per job: time and ok/failed, with no error text). Also `packages/db` `seed` script (synthetic).
- **Tests:** `app.request()` runs against a throwaway Postgres. Every response passes its Zod schema and has the cache header and attribution. A missing env var fails with a clear message.
- ☐ The PR shows a sample `/v1/meta` response with "Data from start.gg"
- ☐ The PR shows responses are cached (header listed)
- ☐ The status endpoint shows times and ok/failed only, with no internal details
- ☐ CI is green

### P1-7 · API: leaderboard, player, search
- **Branch:** `feat/api-read-endpoints` · **Builder:** lead session, with qa-tester for tests
- **Scope:** `GET /v1/leaderboard?limit=&cursor=` (limit capped at 100), `GET /v1/players/:id` (rank or "not yet ranked", rating, RD, 12-month set record, last 10 results; merged aliases redirect to the main player), `GET /v1/search?q=` (≥ 2 characters, tag match with escaped wildcards, 20 results). Exports the typed Hono RPC client for the app.
- **Tests:** pagination, the limit cap, search escaping `%` and `_`, an unknown player returns 404, and the merged-alias redirect.
- **Risks:** too-generous limits could look like a bulk export. Caps are enforced and tested.
- ☐ The PR shows that asking for 1,000 rows returns at most 100
- ☐ The PR shows a sample search result for a seeded name
- ☐ The PR shows a sample player response with "not yet ranked" handled
- ☐ CI is green

### P1-8 · Leaderboard page
- **Branch:** `feat/leaderboard-page` · **Builder:** frontend-ui, with qa-tester for e2e
- **Scope:** the home route. Top 100 as dense `StatRow`s (rank, tag, score, 7-day change). A debounced search box. A "Last updated X min ago" badge from `/v1/meta`. Skeleton, empty, and error states. TanStack Query. The `Attribution` footer, with a link to start.gg, starts here because this is the first screen with start.gg data. In e2e, the API runs locally against the seeded CI Postgres.
- **Tests:** 100 rows render, search finds a seeded player, the badge and attribution are visible, axe is clean, and the page is checked at both viewports. Time-to-first-row is recorded in CI for information. The real "< 2 s" check happens on the Vercel preview.
- ☐ The phone screenshot shows a readable top-100 list in the approved style
- ☐ Typing a name in search shows matches (screenshot)
- ☐ The "Last updated" badge is visible at the top
- ☐ "Data from start.gg" is visible at the bottom
- ☐ The loading screenshot shows grey placeholder rows, not a spinner

### P1-9 · Player page
- **Branch:** `feat/player-page` · **Builder:** frontend-ui, with qa-tester for e2e
- **Scope:** `/player/[id]-[slug]` (with a `vercel.json` rewrite for static hosting). Shows the tag, rank or "Not yet ranked (needs N more sets / events)", the score, rating ± uncertainty, the 12-month win–loss record, recent results (event, date, placing, entrants), a link to the player's start.gg profile, and the attribution.
- **Tests:** ranked and unranked players, a not-found player, opening from a leaderboard row, axe, and both viewports.
- ☐ Tapping a leaderboard name opens that player (screenshots)
- ☐ An unranked player clearly says why they aren't ranked yet
- ☐ Recent results show event name, date, and placing
- ☐ The attribution is visible

### P1-10 · Methodology and status pages
- **Branch:** `feat/methodology-status` · **Builder:** frontend-ui (copy reviewed by ranking-engine)
- **Scope:** `/methodology` (shows METHODOLOGY.md content and links to UltRank as the community ranking) and `/status` (last run per job with green/amber/red: amber after 3 hours, red on failure). Both are linked from the footer. Includes an e2e test that visits every route and checks for attribution.
- ☐ The methodology page explains the ranking without math jargon
- ☐ The status page shows when each job last ran
- ☐ The footer on every page has the attribution and these two links
- ☐ CI is green, with axe clean on both pages

### P1-11 · Sentry error monitoring
- **Branch:** `feat/sentry` · **Builder:** lead session, with qa-tester for tests
- **Scope:** Sentry in `apps/app` (Expo SDK; ⚠ verify web support, with a thin `*.web.ts` fallback to `@sentry/react` if needed), `apps/api`, and `jobs/` (Node SDK). Cron check-ins for sync and rate (⚠ verify the free plan's cron-monitor quota [Q1]; if limited, monitor sync only). `sendDefaultPii: false`, and a `beforeSend` scrubber removes tokens and DB URLs. Everything is a no-op when `SENTRY_DSN` is unset.
- **Tests:** a missing DSN means a no-op with no crash. A captured error reaches a mocked transport. The scrubber removes a fake token.
- ☐ The PR explains what Sentry is in one sentence
- ☐ The PR confirms no personal data or secrets are sent
- ☐ The PR lists what alerts Clay would get (failed sync, bad token)
- ☐ CI is green

### P1-12 · Live verification and fixture re-record (needs Clay's setup)
- **Branch:** `chore/startgg-live-check` · **Builder:** startgg-ingestion
- **Scope:** run `scripts/record-fixtures.ts` with the real token and replace synthetic fixtures. Resolve each "pending live check" in `docs/startgg-notes.md` (location, DQ encoding, updated-after filter, online and singles flags) and fix the isolated functions if needed. Trigger the first 12-month backfill through `workflow_dispatch` and record the real request counts and hours.
- ☐ `docs/startgg-notes.md` has no "pending live check" items left
- ☐ The fixtures README no longer says "synthetic"
- ☐ The status page shows a successful sync and rate run
- ☐ The PR reports actual request use against the ≤ 60/min target

---

## Phase 1 acceptance (Clay, once live data and Vercel are on)
☐ The leaderboard loads on your phone in under 2 s · ☐ The top 20 look plausible next to UltRank (eyeball check; it won't match exactly) · ☐ Searching a known player works · ☐ "Last updated" is under 3 h old · ☐ The methodology page is plain-language · ☐ The attribution is visible

## Decisions needed
- **Decision needed:** which number the leaderboard shows as "Score" (recommended default: the conservative score, rounded, with rating ± uncertainty on the player page).
- **Decision needed:** should players who aren't ranked yet still get a page? (recommended default: yes, labeled "Not yet ranked" with what they still need).
- **Decision needed:** show sponsor prefixes (for example "TEAM | Tag")? (recommended default: yes, small and grey).
- **Decision needed:** should `/status` be public? (recommended default: yes, showing only times and ok/failed).
- **Decision needed:** when to email start.gg (devrelations@start.gg) about the app, as the blueprint's ToS mitigation suggests (recommended default: Claude drafts it at the end of Phase 1, and Clay sends it before sharing the site publicly).
