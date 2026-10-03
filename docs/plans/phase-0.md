# Phase 0 plan: Setup

**Status:** Planned, October 3, 2026 (architect subagent)
**Goal (plain English):** Build the foundations: the code workspace and automatic checks, the database layout, the start.gg connector, the ranking math, and a styled app shell. When Phase 0 is done, Phase 1 only has to fill in real data and real screens.

## Ground rules for this phase

- **Locked decisions.** The eight decisions at the top of `docs/blueprint.md` are locked: 1–7 as recommended, and 8 is the Oct 3, 2026 white light theme in **Design principles**. This plan uses them as-is and does not re-ask them.
- **Merge policy (Clay, Oct 3, 2026, PR #2).** Claude merges its own PR when all three are true: (1) CI is green, (2) the `code-reviewer` subagent's verdict is "Ready", (3) every comment from Clay or Genghis on the PR has a reply. There are no approval stops, including after the style-guide page. Clay can comment after a merge at any time. Claude fixes that feedback in a follow-up PR.
- **Evidence without Vercel.** Vercel is not connected to the repo yet, so PRs have no preview link. Until it is, every PR shows: the CI run link, test counts, and (for UI PRs) Playwright screenshots at 390 px (phone) and 1280 px (desktop). Screenshots are committed under `docs/screenshots/<branch>/` and embedded in the PR description so they show on a phone. Once Clay connects Vercel, the preview link is added too.
- **No live start.gg or database in this environment.** The cloud session blocks `api.start.gg` and has no `STARTGG_TOKEN` or `DATABASE_URL`. So the start.gg type generator ("codegen") reads a committed schema file. Test data ("fixtures") may be synthetic but must match the real response shape and be clearly labeled. Database tests use a throwaway Postgres: a service container in CI, local Postgres 16 in the session. Never production.
- **Always.** Free tiers only. start.gg calls ≤ 60 per minute, through one client. Minimum data, no bulk export, attribution, one token. Tests never call live start.gg. Every PR updates `STATUS.md`. PRs stay under ~400 changed lines, not counting the lockfile, generated code, or fixtures.

## Order and dependencies

P0-1 → P0-2 → then P0-3, P0-4, P0-5, and P0-7 can run in parallel. P0-6 follows P0-5. P0-8 follows P0-7.
(Refinement of the kickoff order: the ADRs ship with this plan in P0-1. The start.gg work and the app work are each split in two to stay under the size limit.)

**As built (lead session, Oct 3, 2026):** P0-2 merged first as [PR #3](https://github.com/HolidayDraco/Smash-rankings/pull/3), and P0-3 through P0-8 were already being built in parallel when this plan landed. To avoid redoing work, P0-5 and P0-6 ship as one PR (`feat/startgg-client`), and P0-7 and P0-8 ship as one PR (`feat/app-shell`). Each PR description notes when it goes over ~400 lines and explains why. P0-4 is built by a general-purpose agent. The gitleaks secret scan uses the official GitHub Action, which needs no license on a personal-account repo.

---

### P0-1 · Phase 0 and Phase 1 plans plus ADR-0001 and ADR-0002
- **Branch:** `docs/phase-0-1-plans` · **Builder:** architect
- **Scope:** `docs/plans/phase-0.md`, `docs/plans/phase-1.md`, `docs/adr/0001-stack.md`, `docs/adr/0002-ranking-method.md`, `STATUS.md`.
- **Tests:** none (docs only). CI is not set up yet.
- **Risks:** none.
- ☐ Both plan files open on your phone and read in plain English
- ☐ ADR-0001 explains why the website starts as "static pages + live data" and when that gets revisited
- ☐ ADR-0002 lists the ranking settings (Glicko-2, weekly periods, conservative score, eligibility)
- ☐ The open decisions at the bottom of each plan have a recommended default

### P0-2 · Monorepo scaffold and CI
- **Branch:** `chore/monorepo-scaffold` · **Builder:** lead session, with qa-tester for the CI workflow
- **Scope:** root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc` (current Node LTS), `.gitignore`, `.env.example` (blank values); `packages/config` (strict tsconfig base, ESLint flat config, Prettier, path aliases); `packages/core` (`ULTIMATE_VIDEOGAME_ID = 1386`, Zod env schemas for `STARTGG_TOKEN` / `DATABASE_URL` / `SENTRY_DSN`, so each app checks only the variables it needs); Vitest workspace; `.github/workflows/ci.yml` (install → lint → typecheck → test → build, pnpm cache, `concurrency`, `timeout-minutes`); a gitleaks secret-scan job (the gitleaks CLI directly, which avoids the action's license question); `.github/workflows/keepalive.yml` (monthly).
- **Tests:** env validation fails fast with a clear message naming the missing variable, and the message never contains a value. The constant equals 1386. CI runs on the PR itself.
- **Risks:** Keepalive: GitHub disables scheduled workflows after 60 days without repository activity [GH2]. The plan is a monthly job that calls GitHub's "enable workflow" API for `ingest.yml`. ⚠ Not yet verified that this resets the timer. If it doesn't, fall back to Dependabot activity. Logged in `STATUS.md` to check by day 50.
- ☐ The PR shows green checks for lint, typecheck, test, build, and secret scan
- ☐ The secret-scan step says "no leaks found"
- ☐ `.env.example` lists the three variable names with empty values
- ☐ The PR description shows the test count (for example, "6 passed")

### P0-3 · Glicko-2 ranking engine
- **Branch:** `feat/ranking-glicko2` · **Builder:** ranking-engine
- **Scope:** `packages/ranking` only. Pure functions: scale conversion, the single-period update, the Illinois volatility solve (ε = 1e-6), the inactivity step, and `ratePeriod(players, sets)`. Settings come from `packages/core` (r 1500, RD 350, σ 0.06, τ 0.5). No DB, network, or clock.
- **Tests:** Glickman worked example (r′ 1464.06, RD′ 151.52, σ′ 0.05999, to 2 decimals). Property tests: a win never lowers a rating, RD shrinks after play, RD grows when inactive. Determinism: shuffled input gives identical output.
- **Risks:** floating-point drift. Mitigated by tolerance-based asserts and a fixed processing order.
- ☐ The PR shows the "Glickman worked example" test passing, with the three numbers
- ☐ CI is green
- ☐ The PR summary explains "rating", "RD" (uncertainty), and "volatility" in one sentence each
- ☐ The package has no database or internet code (reviewer confirms)

### P0-4 · Database schema and first migration
- **Branch:** `feat/db-schema` · **Builder:** startgg-ingestion (ranking-engine reviews the rating tables)
- **Scope:** `packages/db`: Drizzle schema for `tournaments`, `events`, `players`, `sets`, `standings`, `rating_history`, `leaderboard`, `leaderboard_staging`, `ingest_runs`, and `meta` (blueprint §3.3), with the listed indexes. Also `drizzle.config.ts`, the generated first migration, a DB client factory, Zod schemas for rows leaving the package, the `db:generate` / `db:migrate` scripts, and a Postgres 16 service container in `ci.yml`.
- **Tests:** migrations apply cleanly to an empty throwaway Postgres. Running them again is a no-op. Insert and read round-trip each table. Expected indexes exist. `rating_period` is stored as the Monday (UTC) date of the ISO week.
- **Risks:** location columns (`country_code`, `region`) depend on start.gg fields that are not yet verified, so they are nullable. The Neon serverless driver vs. the standard Postgres driver: the factory hides the difference, and tests use the standard one.
- ☐ CI shows a "database migration" test passing against a temporary database
- ☐ The PR lists every table with a one-line plain-English purpose
- ☐ No database address or password appears anywhere in the PR (secret scan green)
- ☐ The PR states the storage estimate (about 250 MB per 1M sets) against Neon's free 1 GB

### P0-5 · start.gg client and rate limiter
- **Branch:** `feat/startgg-client` · **Builder:** startgg-ingestion
- **Scope:** `packages/startgg/src`: one GraphQL client with a token-bucket limiter (≤ 60 req/min), exponential backoff with jitter on "Rate limit exceeded" and 5xx errors, page-size shrinking on "Query complexity too high", a typed auth error (no retry, loud), and structured logs that never include the token. `fetch` and the clock are injectable for tests. Includes a lint rule or test that fails if `api.start.gg` appears outside this package.
- **Tests (fake clock, no network):** never more than 60 requests in any 60-second window, retry after a rate-limit error, retry after a 5xx, page size halves on a complexity error, an auth failure surfaces immediately, and the token is absent from log output.
- **Risks:** limits are per token, so two jobs running at once could double the rate. Phase 1 puts all ingestion workflows in one `concurrency` group.
- ☐ The PR shows a test proving "at most 60 requests per minute"
- ☐ The PR shows tests for the three error cases (too fast, too complex, bad token)
- ☐ The reviewer confirms there are no start.gg calls outside `packages/startgg`
- ☐ CI is green

### P0-6 · start.gg schema, codegen, queries, and fixtures
- **Branch:** `feat/startgg-codegen` · **Builder:** startgg-ingestion
- **Scope:** `packages/startgg/schema/startgg.graphql` (committed schema file, trimmed to the types we use, with its source noted in a header comment), `codegen.ts` plus the `pnpm codegen` script, three query documents (tournaments by videogame, event sets with pagination, event standings), Zod response schemas in `packages/core`, `packages/startgg/fixtures/synthetic-*.json` plus a fixtures README that labels them synthetic, `scripts/record-fixtures.ts` (manual only: needs a token, scrubs unneeded personal data, never runs in CI), and `docs/startgg-notes.md`.
- **Tests:** every fixture parses with its Zod schema. The generated types compile against the documents. CI reruns codegen and fails if the output changed (`git diff --exit-code`).
- **startgg-notes.md "pending live check" list:** player and user location fields, DQ encoding on sets, an "updated after" filter on sets, the online flag, the singles-vs-doubles signal, and the entrant-count field.
- **Risks:** the committed schema could drift from the live one. Mitigated in P1-12, which re-checks against live start.gg once a token exists.
- ☐ The PR lists every start.gg field we request and why we need it ("minimum data")
- ☐ Fixture files are clearly named `synthetic-…` and the README says so
- ☐ `docs/startgg-notes.md` shows each unverified item as "pending live check"
- ☐ CI is green, including the "codegen up to date" check

### P0-7 · App shell, e2e harness, and Vercel config
- **Branch:** `feat/app-shell` · **Builder:** frontend-ui, with qa-tester for Playwright
- **Scope:** `apps/app` on Expo SDK 57 (stable) with Expo Router and `web.output: "static"` (see ADR-0001). Includes the root layout, a placeholder home page, a not-found page, the header with a working title, and a footer with the unofficial-fan-project line. Also `apps/app/vercel.json` (build command, output folder, rewrites for future dynamic routes); `e2e/` Playwright config with phone (390×844) and desktop (1280×800) projects, an axe check, and a screenshot helper; and a `ci.yml` job that builds the web export and runs e2e.
- **Tests:** the home page renders. axe finds no serious or critical issues. The not-found page works. The static export build succeeds in CI.
- **Risks:** Expo web export inside a pnpm monorepo can need Metro config tweaks. Kept in this PR.
- ☐ The phone and desktop screenshots in the PR show a white page with the header and footer
- ☐ The footer says this is an unofficial fan project
- ☐ CI shows the e2e and accessibility checks green
- ☐ There are no Nintendo logos, fonts, or art anywhere

### P0-8 · Design tokens and style-guide page
- **Branch:** `feat/style-guide` · **Builder:** frontend-ui
- **Scope:** `packages/ui/tokens` (colors, type scale, spacing, angle and cut values, motion timings), fonts from Google Fonts packages (Barlow Condensed, Barlow, Saira Condensed; SIL OFL), components (`DisplayText`, `AngledPanel`, `StatRow`, `Badge`, `Attribution`), and the `/style-guide` route. The motion sample respects "reduce motion".
- **Tests:** a unit test checks that every text/background token pair has contrast ≥ 4.5:1. Playwright and axe run on `/style-guide`. Screenshots at 390 px and 1280 px.
- **No approval stop:** Phase 1 screens start right after this merges. Any feedback from Clay becomes a follow-up PR.
- ☐ The screenshots show a white background with bold condensed italic headings
- ☐ There is at least one angled panel with a diagonal cut
- ☐ There is a dense stat row (rank, tag, score, change) that is easy to read at phone width
- ☐ The PR includes a short screen recording or frames of the motion sample
- ☐ No generic gradients, default component-library look, or Nintendo assets

---

## Clay's one-time setup (nothing in Phase 0 waits on this; Phase 1 live data does)
1. **Vercel (Hobby):** import the repo twice: project "app" with root `apps/app`, and project "api" with root `apps/api`. Leave preview deployments on.
2. **Neon (Free):** create a project and copy its connection string into GitHub → Settings → Secrets → Actions as `DATABASE_URL`, and into the Vercel "api" project's environment variables. Never paste it into chat or a PR.
3. **start.gg:** create a token named "smash-rankings prod" and save it as the GitHub secret `STARTGG_TOKEN`. Set a calendar reminder 11 months out, because tokens expire after 1 year [SG1].
4. **Sentry (Developer, free):** create a project and save its DSN as `SENTRY_DSN` in GitHub secrets and in both Vercel projects. This is needed by P1-11.
5. **Claude cloud environment:** set network access to Custom and add `api.start.gg`. Store the token as an API credential. This allows the live checks in P1-12.
6. **Branch protection on `main`:** require a PR and green CI. Claude still self-merges under the merge policy.

## Phase 0 acceptance (Clay)
☐ Screenshots (later, the preview link) show the app shell on a phone · ☐ The style guide shows a white background, condensed italic type, an angled panel, and a dense stat row · ☐ CI is green on every Phase 0 PR · ☐ `docs/adr/` has 2 plain-English ADRs · ☐ The secret scan is green

## Decisions needed
- **Decision needed:** the working title shown in the header until the final name is picked (recommended default: "Bracket Index", neutral and non-Nintendo, easy to change).
- **Decision needed:** the footer disclaimer wording (recommended default: "Unofficial fan project. Not affiliated with Nintendo or start.gg.").
