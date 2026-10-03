# Smash Rankings — Project Instructions for Claude Code

Unofficial fan app showing live Super Smash Bros. Ultimate player rankings computed from start.gg data.
Web first, iOS/Android later from the same Expo codebase. The full plan is in `docs/blueprint.md` (read it when planning; it is deliberately not auto-imported to save context). The kickoff prompt is in `docs/mission.md`. Current status is in `STATUS.md` at the repo root.

## Who you're working for
- The owner, Clay, is **not an engineer**. Write PR descriptions, ADRs, and status notes in plain English. Explain any jargon you can't avoid.
- Clay steers through PRs: a preview link, screenshots, and an acceptance checklist. Once tests and review pass, merge the PR. Do not wait for his approval. This covers every PR, including the style guide page. Decided October 3, 2026.
- The eight choices at the top of `docs/blueprint.md` are locked, including the Oct 3, 2026 light-theme change to decision 8. See **Decisions locked** and **Design principles**. Don't re-ask them. For any new product-facing choice, ask, or use a stated default and say so in the PR.

## Session start, status, and PR comments
- At the start of every session, read `STATUS.md` before planning or editing. It is the running log of what shipped, what's next, and open questions.
- Update `STATUS.md` in every PR, and again at the end of every work session. Each entry has: **Date**, **What changed**, **What's next**, **Questions for Clay**, **Questions for Genghis**.
- Read and respond to pull request comments. Clay and Genghis (Clay's advisor bot) review PRs and leave comments there. Address those comments in the PR thread. Don't ignore them.
- Clay is not an engineer. Every PR description must include a plain-English summary and a phone-friendly checklist of what to look at in the preview.

## Stack (do not change without an ADR in docs/adr/)
- pnpm workspaces + Turborepo monorepo. Node LTS. TypeScript `strict` everywhere. No `any` without a comment explaining why.
- `apps/app`: Expo + Expo Router (universal: web, iOS, Android). Shared UI lives in `packages/ui`.
- `apps/api`: Hono on Vercel Functions. Read-only. Every response is Zod-validated and CDN-cached.
- `packages/db`: Drizzle ORM + drizzle-kit migrations on Neon Postgres.
- `packages/startgg`: typed GraphQL client (GraphQL Code Generator), central rate limiter, recorded fixtures.
- `packages/ranking`: pure TypeScript Glicko-2 (no I/O, no DB imports).
- `packages/core`: shared Zod schemas, types, constants (`ULTIMATE_VIDEOGAME_ID = 1386`).
- `jobs/`: CLI entry points (discover, sync, backfill, rate) run by GitHub Actions on a schedule.

## Commands (keep these working; update this list if scripts change)
- `pnpm install`: install everything
- `pnpm dev`: run app + api locally
- `pnpm lint` / `pnpm format` / `pnpm format:check`: ESLint / Prettier
- `pnpm typecheck`: `tsc --noEmit` across the workspace
- `pnpm test`: Vitest unit tests (all packages)
- `pnpm test --filter @sr/ranking`: one package
- `pnpm e2e`: Playwright against a local web build (`pnpm e2e --ui` to debug)
- `pnpm db:generate` / `pnpm db:migrate`: Drizzle migrations
- `pnpm codegen`: regenerate start.gg GraphQL types
- `pnpm job:discover -- --dry-run`: find events in the last 14 / next 30 days without writing to the DB (`--from` / `--to` override the window)
- `pnpm job:sync -- --dry-run`: run a job without writing to the DB (sync is a stub until P1-2)
- `pnpm job:rate`: recompute ratings and rebuild the leaderboard. Needs only `DATABASE_URL`. `-- --dry-run` prints the top 20 without writing; `-- --as-of 2026-09-01` rates as of a past date

## start.gg rules (IMPORTANT: Terms of Use and rate limits)
- Hard limits: average ≤ 80 requests per 60 s, ≤ 1,000 objects per request including nested ones. Our client targets **≤ 60 req/min** and backs off exponentially on `Rate limit exceeded`. On `Query complexity too high`, it shrinks the page size.
- All start.gg calls go through `packages/startgg`'s client. Never call `fetch` to start.gg anywhere else.
- Request only the fields we display or need (ToS "minimum data"). Never build bulk-export endpoints or redistribute raw start.gg data.
- Every screen showing start.gg data carries the "Data from start.gg" attribution (footer component).
- One token for the product. Never add token rotation or anything else that gets around limits.
- **Tests never hit the live API.** Use recorded fixtures in `packages/startgg/fixtures/`. Live calls only happen in `jobs/` and in explicit manual scripts.

## Secrets (IMPORTANT)
- Never commit secrets, tokens, `.env*` files (except `.env.example` with blank values), or DB URLs. Never print them in logs, PRs, or chat.
- Read secrets from env vars only: `STARTGG_TOKEN`, `DATABASE_URL`, `SENTRY_DSN`. Validate them with Zod at startup and fail fast with a clear message if one is missing.
- Before every commit: `git diff --cached` must contain no secrets. CI runs a secret scan (gitleaks), so don't disable it.

## Code conventions
- Validate at every boundary with Zod: start.gg responses, DB rows leaving `packages/db`, API responses.
- Keep the ranking engine pure and deterministic. The same input gives the same output, with no `Date.now()` inside the math.
- DB changes go through Drizzle migrations only. Never edit an applied migration. Migrations must be additive or include a data-safe plan in the PR.
- Every job is idempotent and resumable (checkpoint cursors in `events.sync_cursor`) and logs one `ingest_runs` row.
- UI: white light theme per **Design principles** in `docs/blueprint.md`. Accessible by default (labels, roles, contrast ≥ 4.5:1, keyboard on web). No Nintendo fonts, logos, or character art. Mobile-first layouts. The frontend agent ships a style-guide page early, then builds real screens without waiting for approval.
- Use path aliases from `packages/config`. No deep relative imports across packages.
- Name things for what they are: `conservativeScore`, not `cs`.

## Testing rules
- New logic needs unit tests in the same PR. Bug fixes start with a failing test.
- `packages/ranking` must keep the Glickman worked-example test passing. The paper prints r′=1464.06, RD′=151.52, σ′=0.05999 but rounds intermediates; full precision gives 1464.0507 / 151.5165 / 0.059996. The test asserts both (see `glicko2.test.ts`). Don't bend the math to hit the paper's rounded digits.
- Every user-visible page has at least one Playwright test, plus an axe check with no serious or critical violations.
- Don't weaken, skip, or delete a test to make CI pass. Fix the cause, or explain in the PR and ask Clay.

## Git and PR workflow
- Branch from `main`: `feat/…`, `fix/…`, `chore/…`, `docs/…`. Conventional commit messages.
- **Small PRs:** one concern each, ideally < 400 changed lines excluding generated files and fixtures.
- Plan first for anything touching more than ~3 files: write the plan in the PR description, or in `docs/plans/` for big items.
- PR description template: **What & why (plain English)** · **Phone-friendly checklist of what to look at in the preview** · **Preview link** · **Screenshots (mobile width)** · **Acceptance checklist (☐)** · **Test evidence** (commands + results) · **Risks / follow-ups**.
- Before marking ready: run the `code-reviewer` subagent on the diff and address its critical findings.
- After the code-reviewer verdict is Ready and CI is green, merge the PR into `main`. Do not wait for Clay's approval. This applies to every PR, including the style guide page.

## Definition of done (every PR)
1. `pnpm lint && pnpm typecheck && pnpm test` pass locally and in CI. `pnpm e2e` passes for UI changes.
2. The Vercel preview deploy works, with screenshots attached for UI changes.
3. There are tests for new behavior, no secrets in the diff, and attribution is present where start.gg data appears.
4. Docs are updated: `STATUS.md` (Date, What changed, What's next, Questions for Clay, Questions for Genghis), plus an ADR if a stack or architecture decision changed, plus METHODOLOGY.md if ranking changed.
5. The PR description is complete and the acceptance checklist is written for a non-engineer.
6. Once the checks above pass and the code-reviewer says Ready, merge. Do not wait for approval.

## Subagents (`.claude/agents/`)
Use them: `architect` (plans/ADRs), `startgg-ingestion`, `ranking-engine`, `frontend-ui`, `qa-tester`, `code-reviewer`. Delegate verbose work (test runs, schema exploration) to keep the main context clean.

## Gotchas
- Ultimate videogame id is **1386**. Rate **sets**, not games. Exclude DQs.
- start.gg tokens expire after 1 year. Auth failures should make the health check and Sentry alert loud.
- Vercel Hobby cron only runs once a day, so scheduling lives in GitHub Actions (`.github/workflows/ingest.yml`).
- Scheduled workflows in public repos get disabled after 60 days without activity. Keep the keepalive workflow.
- When compacting, keep the list of modified files, the current phase, and the open acceptance checklist.
