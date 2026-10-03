# Status

Running log for Smash Rankings. Claude Code reads this file at the start of every session and updates it at the end of every work session and in every pull request.

Each entry includes:

- **Date**
- **What changed**
- **What's next**
- **Questions for Clay** (the owner; not an engineer)
- **Questions for Genghis** (Clay's advisor bot, who reviews pull requests and leaves comments)

---

## 2026-10-03

**Date:** October 3, 2026

**What changed:** Planning documents and Claude Code setup were loaded into the repo. That includes `CLAUDE.md`, `docs/blueprint.md`, `docs/mission.md`, the six subagents in `.claude/agents/`, and this status log. Clay locked the eight recommended defaults in the blueprint (public repo, 64-entrant singles, in-person only, Glicko-2, 12 months live / 24 months history, 2-hour refresh, Neon, neutral name). The look was revised later the same day; see the next entry. Phase 0 has not started. No application code has been written.

**What's next:** Phase 0 (setup). The next session should read `CLAUDE.md`, `docs/blueprint.md`, and this file, then have the architect subagent write `docs/plans/phase-0.md` and `docs/plans/phase-1.md` before any app code.

**Questions for Clay:** None.

**Questions for Genghis:** None.

---

## 2026-10-03 — design direction

**Date:** October 3, 2026

**What changed:** Clay changed decision 8. The app uses a white background and a light theme, not a dark one. The feel should be premium and specific: bold condensed italic display type, angled panels, dense stat layouts, strong color accents, and snappy motion, close to Super Smash Bros. Ultimate's UI but built only from original design. Fonts are freely licensed Google Fonts (Barlow Condensed italic for display, Barlow for UI text, Saira Condensed italic as a sportier option). No Nintendo fonts, logos, character art, or other assets. No generic component-library look and no generic gradients. The frontend agent must ship a style-guide page early. Updated `docs/blueprint.md` (Decisions locked #8 and Design principles), `.claude/agents/frontend-ui.md`, and the related notes in `CLAUDE.md` and `docs/mission.md`. The wait for Clay's approval before real screens was removed later the same day; see the auto-merge entry below.

**What's next:** Phase 0 (setup) has not started. The next session should read `CLAUDE.md`, `docs/blueprint.md`, and this file, then have the architect write `docs/plans/phase-0.md` and `docs/plans/phase-1.md`. The first UI work includes the style-guide page.

**Questions for Clay:** None.

**Questions for Genghis:** None.

---

## 2026-10-03 — auto-merge, no approval stops

**Date:** October 3, 2026

**What changed:** Clay decided Claude Code may merge all of its own pull requests once tests and review pass. There is no approval stop, including on the style guide page. The style guide page stays a deliverable and is still built early. Real screens start right after it, without waiting. Updated `docs/blueprint.md`, `docs/mission.md`, `CLAUDE.md`, `.claude/agents/frontend-ui.md`, and `.claude/agents/architect.md` so plans do not put that wait back in. Pull request: https://github.com/HolidayDraco/Smash-rankings/pull/2

**What's next:** Phase 0 (setup) has not started. The next session should read `CLAUDE.md`, `docs/blueprint.md`, and this file, then have the architect write `docs/plans/phase-0.md` and `docs/plans/phase-1.md`. The first UI work still includes the style-guide page, then continues into real screens without waiting.

**Questions for Clay:** None.

**Questions for Genghis:** None.

---

## 2026-10-03 — Phase 0: monorepo scaffold

**Date:** October 3, 2026

**What changed:** Set up the project's skeleton (the "monorepo": one repository that will hold the app, the API, the data jobs, and shared code). Added:

- Shared settings for TypeScript (strict mode), ESLint (catches bugs), and Prettier (consistent formatting) in `packages/config`.
- `packages/core` with the locked product rules as constants (Ultimate's id 1386, 64+ entrants, in-person only, leaderboard eligibility) and a check that stops a program immediately, with a clear message, if a secret like the start.gg token is missing. The message names the missing setting and never prints its value.
- Automatic checks on every pull request (GitHub Actions "CI"): formatting, lint, type check, unit tests, and a secret scan (gitleaks). A build step gets added in the first PR that has something to build (the app shell).
- A monthly "keepalive" job so GitHub doesn't switch off our scheduled data jobs after 60 quiet days.

This follows the auto-merge rule from PR #2: Claude merges its own PRs once checks and review pass.

**What's next:** Plans (`docs/plans/`), ADR-0001 and ADR-0002, then the ranking engine, database schema, start.gg client, and app shell with the style-guide page.

**Questions for Clay:** Until these are set up, Claude builds and tests against saved sample data and a throwaway local database:

1. **start.gg token:** create one and save it as the GitHub Actions secret `STARTGG_TOKEN`. Also add `api.start.gg` to this Claude cloud environment's network allowlist (it's blocked right now).
2. **Neon:** create a free project and save its connection string as the GitHub Actions secret `DATABASE_URL`.
3. **Vercel:** connect the repo so PRs get preview links.

**Questions for Genghis:** None.

---

## 2026-10-03 — Phase 0 and Phase 1 plans, ADR-0001, ADR-0002

**Date:** October 3, 2026

**What changed:** The architect wrote the build plans and the first two decision records ("ADRs": short notes on why we chose something):

- `docs/plans/phase-0.md`: the setup PRs, in order, each with a phone-friendly checklist, plus Clay's one-time setup steps.
- `docs/plans/phase-1.md`: the MVP PRs, from the data jobs through the leaderboard, player, methodology, and status pages, plus Sentry error alerts.
- `docs/adr/0001-stack.md`: the technology choices. Expo SDK 58 is still a pre-release, so the website starts as pre-built pages that load live numbers from our API. Server rendering is revisited once SDK 58 is stable.
- `docs/adr/0002-ranking-method.md`: how players are rated. Glicko-2 on sets, not games. DQs are excluded. One rating period per week. The leaderboard is sorted by a "conservative score" (rating minus twice the uncertainty), and there are eligibility rules.

**What's next:** The scaffold merged as [PR #3](https://github.com/HolidayDraco/Smash-rankings/pull/3). Next are the ranking engine, database schema, start.gg client, and app shell with the style guide. All four are being built in parallel.

**Questions for Clay** (each has a default Claude will use unless you say otherwise):

1. Working title in the header? Default: **"Bracket Index"**.
2. Footer disclaimer? Default: **"Unofficial fan project. Not affiliated with Nintendo or start.gg."**
3. What number does the leaderboard show as "Score"? Default: the rounded conservative score, with rating ± uncertainty on the player page.
4. Do unranked players get a page? Default: yes, labeled "Not yet ranked" with what they still need.
5. Show sponsor prefixes (like "TSM | Tweek")? Default: yes, small and grey.
6. Is the `/status` page public? Default: yes, showing only times and ok/failed.
7. When should start.gg be told about the app? Default: Claude drafts the email at the end of Phase 1, and you send it before sharing the site publicly.

**Review fixes (code-reviewer):** The worked-example test tolerance now matches the paper's real precision (see ADR-0002 item 9). The data-job schedule no longer lets a long backfill starve the 2-hourly sync or silently drop the daily discover: backfill is capped at ~75 minutes a night, and discover runs inside sync. Weekend hourly sync no longer double-fires on even hours. The player URL is `/player/1234-tagname` (a valid route). API caching is longer (15 min), so the free Neon database sleeps more. Extra history beyond 12 months is display-only unless Clay decides otherwise. The leaderboard API returns only the top 100, with no paging, so it can't be used to bulk-copy data. Clay's branch-protection step now says to set required approvals to 0, or Claude couldn't self-merge.

**Questions for Genghis:** None open. Genghis confirmed on PR #4 that re-rating the current, unfinished week on every run is right for the "live" feel. Genghis also said not to wait on Clay for the seven defaults above, so Claude uses them unless Clay says otherwise.

---

## 2026-10-03 — Phase 0: database schema

**Date:** October 3, 2026

**What changed:** Added `packages/db`, the layout of our database ("schema") and the first "migration" (the script that creates the tables). There are nine tables: tournaments, events, players, sets, standings, rating history, the leaderboard, a log of every data-job run, and a small settings table. The database itself enforces some rules: a set can't have the same winner and loser, a score can't be negative, and nothing can point at a player who doesn't exist. An automatic test builds the whole database from scratch in a throwaway Postgres on every PR, runs the setup twice to prove re-running is safe, and checks each table. Only fields the app shows or needs are stored (start.gg's "minimum data" rule).

**What's next:** Ranking engine, start.gg client, and app shell PRs, then Phase 1's data jobs.

**Questions for Clay:** None new. The Neon setup ask above still stands; the app can't save real data until it exists.

**Questions for Genghis:** The leaderboard is rebuilt by deleting and re-inserting it in one database transaction, instead of the blueprint's "build a new table and swap" approach, because a swap would drop the safety links (foreign keys) to the players table. Readers never see a half-built leaderboard either way. OK?

---

## 2026-10-03 — Phase 0: Glicko-2 ranking engine

**Date:** October 3, 2026

**What changed:** Added `packages/ranking`, the math that turns set results into ratings. It's pure math: no internet, no database, no clock, so the same results always give the same rankings. In plain terms:

- **Rating** is how strong we think a player is (everyone starts at 1500).
- **RD** ("rating deviation") is how *unsure* we are about that rating. It shrinks as a player plays and grows while they're inactive.
- **Volatility** is how erratic a player's results are.
- The leaderboard sorts by a **conservative score** = rating − 2 × RD, so a lucky newcomer can't jump to #1.

Also includes the weekly rating-period helper, the eligibility rule (10+ sets, 3+ qualifying events, RD ≤ 110), the leaderboard sort with fixed tie-breaks, and a first draft of `docs/METHODOLOGY.md` for fans.

**About the "Glickman worked example" test:** Glickman's paper prints the answer as 1464.06 / 151.52 / 0.05999, but it rounds numbers partway through its own calculation. Doing the math at full precision gives 1464.0507 / 151.5165 / 0.059996. Claude checked this with a second, independent calculation. The test now checks the full-precision answer tightly, and it also checks agreement with the paper's printed numbers to the precision the paper actually carries. `CLAUDE.md` and the ranking agent's instructions now explain this, so no one "fixes" the math to match the rounded digits.

**What's next:** start.gg client and app shell PRs, then Phase 1 data jobs.

**Questions for Clay:** Claude updated the worked-example rule in `CLAUDE.md` to note the paper's rounding (the numbers you listed, 1464.06 / 151.52 / 0.05999, are still checked). Under your auto-merge rule this merged without waiting. If you'd rather that rule stay word-for-word, say so and Claude will revert just that line.

**Questions for Genghis:** Does the worked-example test approach (exact values asserted tightly, plus the paper's printed figures within 0.01 and σ within 0.00001) look right to you?

---

## 2026-10-03 — Phase 0: start.gg client

**Date:** October 3, 2026

**What changed:** Added `packages/startgg`, the only code allowed to talk to start.gg. It:

- **Paces itself** to at most 60 requests a minute (start.gg's hard limit is 80), and a test proves it never goes over in any 60-second window.
- **Backs off and retries** when start.gg says "slow down" or has a server hiccup, and **asks for smaller pages** when start.gg says a request is too big.
- **Stops immediately on a bad or expired token** (no pointless retries), so the alert is loud.
- **Never writes the token into logs** (tested).
- **Asks only for the fields we store** (start.gg's "minimum data" rule): tournaments, events, sets, and placements, with player tags and ids. No emails, no locations yet.
- **Turns DQs into a flag** so the ranking math can skip them.

Because this environment can't reach start.gg, the list of start.gg fields our code can use (the "schema") is a hand-trimmed copy, and the test data is made up (fake player tags, clearly labeled "synthetic"). Scripts to refresh both from the real API are included for when a token and network access exist. What still needs checking against live start.gg is listed in `docs/startgg-notes.md`.

**Rough cost:** a 2,000-player event is about 120 requests, roughly 2 minutes at our pace.

**What's next:** App shell + style guide PR, then Phase 1: the discover job.

**Questions for Clay:** To let Claude check against the real start.gg, add both `api.start.gg` and `developer.start.gg` to this cloud environment's network allowlist, and provide the token (see the setup list in `docs/plans/phase-0.md`).

---

## 2026-10-03 — Phase 0: app shell and style guide

**Date:** October 3, 2026

**What changed:** The first version of the website:

- **App shell** (Expo SDK 57, pages built ahead of time per ADR-0001): a header, a home page, and the "Data from start.gg" footer on every page. It works on phone and desktop.
- **Style guide page** (`/style-guide`): white background, Barlow Condensed black italic headings, color swatches with their contrast scores, an angled panel with a diagonal cut, a dense stat row (rank, tag, rating, ± uncertainty, change shown with arrows *and* color), and a snappy motion sample that respects "reduce motion" settings. Fonts ship with the app (no Google Fonts call). No Nintendo fonts, logos, or art. Sample player names are fake.
- **Working title "Bracket Index"** in the header (the neutral-name default from the open questions; easy to change).
- **Automatic browser tests** (Playwright) on phone (390 px) and desktop (1280 px) sizes. They check titles, headings, the start.gg attribution link, no sideways scrolling, keyboard focus, 44 px touch targets, and an accessibility scan (axe) with zero serious or critical issues. A unit test checks every text color against its background is at least 4.5:1 contrast.
- **Vercel settings** are ready (`apps/app/vercel.json`), but Vercel isn't connected yet, so screenshots stand in for a preview link.

Per Clay's auto-merge rule, real screens start right after this merges.

**What's next:** Phase 1: discover job, sync, backfill, rate job, API, then the leaderboard and player pages.

**Questions for Clay:** Do you like the look? Any feedback becomes a follow-up PR, so nothing waits on it. Connecting Vercel (setup step 1) will give you a tappable preview on every PR.

**Questions for Genghis:** None.
