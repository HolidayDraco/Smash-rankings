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

---

## 2026-10-03 — Phase 1: rating history and leaderboard builder

**Date:** October 3, 2026

**What changed:** Added the pure math that turns a year of sets into a leaderboard (no database or internet involved):

- **Week by week:** walks every week in order, rating everyone who played. Players who sat out a week become a little less certain (their RD grows). It keeps one history row per player per week, which will drive rating charts later.
- **Who's eligible:** counts each player's rated sets and the qualifying events they attended in the last 52 weeks, then applies the rule: 10+ sets, 3+ events, RD ≤ 110.
- **The leaderboard:** eligible players are ranked by conservative score. Everyone else is listed after them, unranked. **Rank change over 7 days** compares this week's ranks with last week's: positive means moved up, and it's blank for newly ranked or dropped players.
- **Merged accounts:** if one person has two start.gg accounts and we've marked them as the same player, their results are combined.
- **Speed:** a synthetic year of 2,000 players and 20,000 sets takes about 0.2 seconds. 50,000 players and 300,000 sets take about 11 seconds, which is fine for a job that runs every couple of hours.

METHODOLOGY.md gained a short "rank change over 7 days" section.

**What's next:** The rate job (P1-5) uses this to fill the database. Then come the leaderboard and player pages.

**Questions for Clay:** None.

**Questions for Genghis:** A player who entered an event but whose only sets there were DQs still gets credit for *attending* that event (it counts toward "3+ events"). The DQ sets themselves never count toward ratings or the "10+ sets" rule. OK?

---

## 2026-10-03 — Phase 1: which events count, and the discover job

**Date:** October 3, 2026

**What changed:**

- **"Which events count" rules in code** (decisions 2 and 3):
  - *Counts:* an Ultimate singles event with 64+ entrants, held in person.
  - *Saved but never counted:* an online event with 64+ entrants.
  - *Not saved at all:* anything else, such as 63 or fewer entrants, doubles, or other games. Not saving these is start.gg's "minimum data" rule.
- **The `discover` job** (`pnpm job:discover`) looks through start.gg for Ultimate tournaments from the last 14 days and the next 30, applies the rules, and saves qualifying events to the database. Running it twice never makes duplicates, and it never undoes progress the sync job has already made. Each run writes one line to the job log (how many start.gg requests it used, and whether it worked). `--dry-run` shows what it *would* save without touching the database.
- **A shared "job harness"** that every data job uses: time limits, the job log, clean error codes, and error messages scrubbed of the token and database address.

Sample dry run (from the made-up test data): `discover: 4 events found, 2 qualify, 0 online stored, 2 skipped; 2 requests`.

**What's next:** The sync job (sets, placements, players), the backfill, and the scheduled workflow.

**Questions for Clay:** None.

**Questions for Genghis:** start.gg can't filter tournaments by size, so discover pages through *every* Ultimate tournament in the 44-day window, at 20 per request. The daily target of ≤ 50 requests holds only up to ~1,000 tournaments in that window. If the live check (P1-12) shows more, the plan is to scan the full window weekly and only the last 3 days daily. That stays far under the 60/minute limit either way. OK?

---

## 2026-10-03 — Phase 1: API skeleton

**Date:** October 3, 2026

**What changed:** Added `apps/api`, the small read-only web service ("API") that the website and, later, the phone apps ask for data. There are two endpoints so far:

- `/v1/meta`: when the rankings were last updated (this feeds the "Last updated" badge).
- `/v1/status`: when each data job last ran and whether it worked. It shows only times and ok/failed, never error details.

Every answer is checked against a strict format before it's sent, says "Data from start.gg", and is cached by Vercel's network for 15 minutes. That keeps it fast and keeps the free database mostly asleep. Only our own website's addresses may call it from a browser.

Also added `pnpm db:seed`, which fills a test database with **made-up** data (30 players named like "Sample_Ace", 3 fake tournaments) so screens and tests have something to show before real start.gg data exists. It refuses to run against the real Neon database unless explicitly told to.

ADR-0001's cache time was corrected to 15 minutes to match the plan.

**What's next:** API endpoints for the leaderboard, player, and search; the sync and rate jobs; then the leaderboard page.

**Questions for Clay:** When you connect Vercel, the API is a **second** Vercel project from the same repo: Root Directory `apps/api`, Framework "Other", plus `DATABASE_URL` and `ALLOWED_ORIGINS` (the app's web address) as environment variables.

**Questions for Genghis:** In `/v1/status`, a run that hit its time limit and will resume next time ("partial") counts as ok. Agree?

---

## 2026-10-03 — Phase 1: sync job

**Date:** October 3, 2026

**What changed:** Added the `sync` job (`pnpm job:sync`). For each event that counts, it pulls the sets (who beat whom and the game score), the final placings, and the players (tag, sponsor prefix, start.gg profile link). In plain terms:

- **Picks up where it left off.** It saves its place after every page, so a stopped run resumes without missing or doubling anything.
- **Catches bracket fixes.** About three days after an event starts, it re-checks it once. Events still in progress are re-read from the start each run so they stay fresh.
- **Never fetches online events**, per Genghis: they're stored as names and dates only.
- **DQs** are saved with a "DQ" flag and no score, so the ranking math skips them.
- **One bad event doesn't stop the rest.** It's marked "error" and retried next time. A bad or expired token stops everything loudly.
- **Budget:** about 4 start.gg requests for a 64-player event and about 16 for a 256-player one. One run handles up to 25 events, which takes roughly 2–7 minutes at our pace.

Each set is tagged with its week number (week 2960 is the week of Oct 3, 2026), which is what the weekly ratings use.

**What's next:** The backfill (12 months of history) and the scheduled workflow, then the rate job.

**Questions for Clay:** None.

**Questions for Genghis:** None open. Genghis decided that an event that keeps failing stays uncapped for now. After the live check (P1-12), if such events show up, the sync job will stop after 3 consecutive errors and "park" the event until someone re-runs it by hand with `--event`. Genghis also caught that per-event error messages weren't scrubbed of secrets, and that's fixed in this PR.

---

## 2026-10-03 — Phase 1: API leaderboard, player, and search

**Date:** October 3, 2026

**What changed:** The API can now answer the three questions the first screens need:

- **`/v1/leaderboard`:** the top ranked players (at most 100) with tag, country, score, rating ± uncertainty, 7-day change, and last active date. There's no way to page past the top 100, so nobody can use it to copy start.gg's data in bulk (start.gg's terms).
- **`/v1/players/<id>`:** one player: rank (or *why* they aren't ranked yet: "needs 1 more set", "uncertainty still too high"), rating, win–loss record for the last 12 months (DQs excluded), their last 10 results, and a link to their start.gg profile. If two accounts were merged into one player, the old address forwards to the main one.
- **`/v1/search?q=`:** finds players by tag, at least 2 characters, ranked players first. Searches like "  ACE " and "ace" are treated as the same, so they share the same cached answer.

Every answer is checked against a strict format, carries "Data from start.gg", and is cached for 15 minutes. A typed "client" lets the website call these with spell-checked route and field names.

**What's next:** The leaderboard page and player page, built on these endpoints.

**Questions for Clay:** None.

**Questions for Genghis:** (1) This PR is ~660 lines (~350 code, ~220 tests, ~90 response formats), over the ~400 target you asked for. The tests weren't cut to fit. (2) Results from a merged player's *old* account aren't added to their record yet. That's a follow-up once alias merges are actually in use. OK?

---

## 2026-10-03 — Phase 1: rate job

**Date:** October 3, 2026

**What changed:** The `rate` job (`pnpm job:rate`) turns the stored sets into ratings and the leaderboard. It's the last piece of the data pipeline (discover → sync → rate). Each run:

- Rates every week of the last 12 months from scratch with Glicko-2, using only sets from in-person, 64+ entrant events. DQs, online events, and sets between two accounts merged into one player are skipped.
- Builds the leaderboard (players with 10+ sets, 3+ events, and low enough uncertainty), with each player's **last active** date taken from their actual last set.
- Works out the **7-day rank change** by comparing against a snapshot of last week's final ranks, taken when the week rolls over. If there was no run last week, everyone shows "new" rather than a misleading number.
- Saves everything in one step, so visitors see either the old leaderboard or the new one, never a half-built one. It then bumps the "last updated" time.
- Keeps the database small. Week-by-week history is stored only for weeks a player actually played (plus the current week), instead of every week (about 300 MB at 50,000 players). How big it gets depends on how often people play. At 50,000 players it's about **25–40 MB** if most players go to a few events a year (the usual pattern), and up to about **130 MB** if everyone played evenly all year. Two caveats:
  - The first run each week rewrites most history rows (everyone's ratings shift slightly as the 12-month window moves). Until the database's routine cleanup reclaims the old copies, the table can briefly take about **twice** its normal space.
  - These are estimates. Each run's summary prints the real number of history rows, so we'll check the actual size after the 12-month backfill.
- Prints the top 20 into the GitHub Actions run page (with the "Data from start.gg" credit), so each run can be eyeballed.
- Never trips over itself: if two runs overlap, the second waits for the first to finish saving, so last week's ranks can't be saved under the wrong week.

Ranking tweaks: equal scores now break ties by the *numerically* lower start.gg id (ADR-0002), and some safety checks were added. METHODOLOGY.md now says: "7-day change is compared with the ranks at the end of last week", and "an event where every one of your sets was a DQ still counts toward the 3 events" (Genghis's ruling).

**Speed:** a synthetic year of 2,000 players and 20,000 sets rates in about 1 second.

**What's next:** The scheduled workflow (discover → sync → rate every 2 hours, hourly on weekends) and the backfill, then the leaderboard and player pages.

**Questions for Clay:** None.

**Questions for Genghis:** None open. Per Genghis, `--as-of <date>` is a manual diagnostic only, so it always runs as a dry run and can never rewrite the live leaderboard or the 7-day snapshot. Scheduled runs never pass it.

---

## 2026-10-03 — Phase 1: leaderboard page

**Date:** October 3, 2026

**What changed:** The home page is now the **leaderboard**, the first real screen:

- **Top 100 ranked players** as dense rows: rank, tag (sponsor prefix small and grey), country, score, and the 7-day change (an arrow *and* a number, so it isn't color-only).
- **Search box:** start typing a tag (2+ letters) and matching players replace the list; ranked players come first, unranked show "NR". Escape or "Clear" brings the leaderboard back.
- **"Last updated X min ago"** badge, from the API.
- **Grey placeholder rows** while loading (no spinner), a friendly message if nothing matches, and a **"Try again" button** if the API is unreachable.
- **"Data from start.gg"** in the footer and an "unofficial fan project" note.
- Tapping a player goes to their page. That page arrives in the next PR, so for now those links don't work yet.

The website talks to the API through the typed client, and Claude checked that the page's code contains **no server or database code** (only the small web-request library).

Automatic browser tests now run against a real temporary database filled with the made-up sample players, with the API running alongside.

**What's next:** Player page, then the methodology and status pages, then Sentry error alerts.

**Questions for Clay:** Look at the phone screenshot in the PR. Does it look like the leaderboard you pictured? Any feedback becomes a follow-up PR. Before the Vercel preview can show real data, one setup step in Vercel: on the **app** project, add a setting named `EXPO_PUBLIC_API_URL` set to the API's public address (not a secret). On the **API** project, add `ALLOWED_ORIGINS` (the app's address) and, for preview links, `ALLOWED_ORIGIN_PATTERN`, so the API lets the app's pages talk to it.

**Questions for Genghis:** This PR is about 675 hand-written lines (two row/list components are most of it), over the ~400 target. OK, or split?

---

## 2026-10-03 — Phase 1: player page

**Date:** October 3, 2026

**What changed:** Tapping a player on the leaderboard now opens their **player page** (`/player/1234-sample-dash`):

- Their tag and country, and a big angled panel with their **rank** (or **"Not yet ranked"**).
- **Score**, and **rating ± uncertainty** with a plain-English explanation for screen readers.
- A compact stats row: sets rated, events, and 12-month win–loss.
- If they aren't ranked yet, **why**, in plain words. For example: "Needs 1 more rated set" or "Rating still uncertain".
- **Recent results**: event, tournament, date, and placing ("4th of 128").
- A **"View on start.gg"** link when we know their start.gg profile.
- Grey placeholders while loading, a friendly **"Player not found"** with a link back, and **Try again** on errors.
- "Data from start.gg" at the bottom, as on every page.

Because the website is built ahead of time, one shared player page loads each player's data in the browser. A small hosting rule (`apps/app/vercel.json`) sends every `/player/...` address to it.

**What's next:** Methodology and status pages (built, PR next), then Sentry error alerts.

**Questions for Clay:** None. Check the phone screenshots in the PR.

**Questions for Genghis:** The hosting rule for `/player/...` can only be confirmed on the first Vercel preview. If it fails there, it's a one-line fix.

---

## 2026-10-03 — Phase 1: Sentry error alerts

**Date:** October 3, 2026

**What changed:** Added **Sentry**, a free service that emails you when something breaks, so problems don't go unnoticed:

- **Website:** if a page crashes, visitors see a friendly "Something went wrong" panel with a Reload button, and the error is reported.
- **API:** server errors (not "bad request" ones) are reported.
- **Data jobs:** a failed run is reported, tagged with which job. If start.gg rejects the token (they expire yearly), it's reported as **fatal: "start.gg token rejected (expired?)"** so it's loud.
- **Missed-run alerts ("cron monitors")** for sync and rate. Sentry warns if two scheduled runs in a row don't check in.
- **Privacy:** no personal data, cookies, or request headers are sent. Tokens, database addresses, and secret-looking web addresses are scrubbed before anything leaves (tested).
- **Off until set up:** with no Sentry key it does nothing at all. The website doesn't even download the Sentry code until a key exists, so visitors' pages stay as small as before.

Details are in `docs/monitoring.md`.

**What's next:** Methodology and status pages (built, PR next). The scheduled data workflow (#16) is on hold for the Texas scope question. Once #16 merges, a small follow-up passes `SENTRY_DSN` to the sync and rate steps, so job alerts actually turn on.

**Questions for Clay:**
1. To turn on alerts:
   - Create a free Sentry project.
   - Add its key ("DSN") as a GitHub Actions secret `SENTRY_DSN`, as `SENTRY_DSN` on the Vercel API project, and as `EXPO_PUBLIC_SENTRY_DSN` on the Vercel app project. That last one is public by design, so it's not a secret.
2. Sentry's free plan's number of missed-run monitors isn't confirmed. If it's limited, set the GitHub Actions variable `SENTRY_CRONS` to `sync`.

## 2026-10-03 — Phase 1: "How rankings work" and "Data status" pages

**Date:** October 3, 2026

**What changed:**

- **How rankings work** (`/methodology`): the ranking rules in plain English. It covers what counts, how ratings move, why the list uses a "conservative score", who appears, rank changes, and how often the numbers update. The text is the same as `docs/METHODOLOGY.md`, and a test fails if the two ever drift apart.
- **Data status** (`/status`): when each data job last ran, and whether it worked. This shows at a glance whether the numbers are fresh.
- Both pages are linked from the footer on every page.
- The browser tests can now run on other ports, so parallel runs don't collide.

**What's next:** The scheduled data workflow (#16), once the Texas scope is settled, plus its small follow-up that turns on job alerts (`SENTRY_DSN` in the workflow).

**Questions for Clay:** The methodology page still says "at least 64 entrants" and covers all regions. If the Texas-only, 16+ entrant change posted on PR #16 is confirmed, this text changes with it.

**Questions for Genghis:** None.

---

## 2026-10-03 — Scope change: Texas only, 16+ entrants

**Date:** October 3, 2026

**What changed:** Clay confirmed the new launch scope, and the plan documents now say so:

- **Texas only.** Only tournaments held in Texas are ingested and rated, so the leaderboard is Texas players. The region is a single setting, so more states can be added one at a time later.
- **16+ entrants.** In-person singles events with 16 or more entrants count, so Texas locals do too. Before this, the cutoff was 64.
- **Next phase, not now:** a federation-rankings tab, user logins, and admin users.

Updated: `docs/blueprint.md` (decision 2 changed, decision 9 added, older notes marked superseded), `CLAUDE.md`, `docs/mission.md`, `docs/plans/phase-1.md`, the ingestion agent's instructions (`.claude/agents/startgg-ingestion.md`), a note in `docs/adr/0002-ranking-method.md`, and a new decision record, `docs/adr/0003-texas-launch-scope.md`. No code changes in this PR.

**What's next:**

1. The code change: a `LAUNCH_REGIONS` setting, a Texas filter when finding events, the 16+ cutoff in the rate job, and the methodology page.
2. Then the scheduled data jobs (#16), with the request budget re-checked for many more, smaller events.

**Questions for Clay:** One yes/no, no rush: should out-of-state visitors who play enough Texas events appear on the leaderboard? The default is **yes**, so everyone who plays at Texas events is rated.

**Questions for Genghis:** None. Your scope comment on #16 is now on `main`.

---

## 2026-10-03 — Code for the Texas scope (16+ entrants)

**Date:** October 3, 2026

**What changed:** The code now matches the scope Clay confirmed:

- **Texas only.** A new setting, `LAUNCH_REGIONS`, lists the places we cover (United States, state TX). Adding a state later means adding it to that list (plus its full name), then re-checking the last 12 months of events. Events held anywhere else are skipped and not stored. If an already-stored event turns out to be outside Texas, it stops counting the next time we check it.
- **16+ entrants.** The cutoff for in-person singles events went from 64 to 16. Online events still never count.
- **Wording.** The methodology page (and `docs/METHODOLOGY.md`) now say "held in Texas" and "at least 16 entrants", and mention more states may come.
- **Test data.** The made-up sample events and the seed data are now in Texas, and there is a made-up California event to prove it gets skipped.
- `docs/startgg-notes.md` records the rule and what is still unchecked: whether start.gg writes the state as "TX" or "Texas", and whether start.gg can filter by state on its side (which would cut the number of requests).

Discover still reads every Ultimate tournament nationwide and filters locally, so its request count is unchanged by this PR.

**What's next:**

1. Rebase PR #16 (scheduled jobs) on this and re-check the request budget for many more, smaller events.
2. The live check (P1-12) to confirm the state format and the server-side filter.

**Questions for Clay:** None.

**Questions for Genghis:** None.

---

## 2026-10-03 — Phase 1: backfill and the scheduled data workflow (Texas)

**Date:** October 3, 2026

**What changed:** The data jobs now run on their own, on a schedule (GitHub Actions, `.github/workflows/ingest.yml`):

- **Every 2 hours**, and **every hour Friday–Monday** (tournament weekends): **sync** pulls new results, then **rate** rebuilds the leaderboard. The first sync each day also runs **discover** to find new events, so there's no separate discover schedule to clash with.
- **Every night at 07:41 UTC: backfill** works backwards through the last 12 months, one chunk per night. It usually takes only a few minutes, because it stops when its 30 daily discover requests are used; 75 minutes is only the safety cap. It remembers where it stopped and resumes the next night. The ≤ 50 discover requests a day limit is enforced and split: the daily discover gets 20 (it only looks 3 days back and 7 ahead) and backfill gets 30 (after 12:00 UTC either can use the other's leftovers). A month cut short continues the next day. At that pace the full 12 months need roughly **8 weeks (about 2 months)** of nights (a guess until the live check). When it's done, it does nothing.
- **Jobs never overlap**: they share one queue, so the rate job can't step on itself. GitHub keeps only one waiting run per queue, so starting a manual run while another is already waiting can cancel the waiting one. The hourly weekend sync skips 07:23 to protect the backfill: otherwise a running 07:23 sync makes the 07:41 backfill wait, and the 08:23 sync then replaces the waiting backfill (GitHub keeps only one waiting run per queue). Once the discover cap is raised and backfill runs long, the 08:23 and 09:23 syncs can queue behind it and one may be replaced, which is a missed Sentry check-in; Sentry tolerates one miss. To be checked at P1-12.
- **Safe before setup**: until the start.gg token and database address are added as GitHub secrets, each run just writes "not configured yet" and stops. It doesn't fail, and it doesn't send daily error emails.
- **You can also start a job by hand** from the GitHub Actions tab ("Run workflow"): sync, backfill (with a number of months), or rate.
- Each rate run reports the **database size** and warns at 70% of Neon's free 1 GB.
- Automatic checks now also lint the workflow files (actionlint).
- **Texas only, 16+ entrants** (decided earlier today): the jobs only keep Texas events, and each Texas local is cheap to sync (about 2 to 4 requests). Finding events is the slow part: start.gg is still read for every Ultimate tournament, then filtered to Texas.
- **Error alerts:** the sync, backfill and rate jobs now get the Sentry key, so failures and missed runs reach you once `SENTRY_DSN` is added as a GitHub secret.

**What's next:** Phase 1 is complete in code. The last step, the first live check (P1-12), needs your setup: the start.gg token, a Neon database, Vercel, and Sentry. It will measure real request counts, confirm how start.gg writes "Texas", and check whether start.gg can filter tournaments by state, which would cut the history fill from about 8 weeks to a few nights.

**Questions for Clay:**
1. **Heads-up on timing:** with our 50-requests-a-day limit for finding events (30 of it for backfill), the 12-month Texas history may take about 8 weeks to fill in. The live check will tell us whether a start.gg state filter can shorten that to a few nights.
2. **Neon compute hours** can't be read automatically. About once a month, glance at the Neon dashboard's "Compute hours" (the free plan includes 100 per month). Claude will add an alert later if usage gets close.
3. Once the GitHub secrets (`STARTGG_TOKEN`, `DATABASE_URL`) are in, the first backfill starts that night. You can also start it right away from the Actions tab.

**Questions for Genghis:** Default I picked, please confirm: the 50/day discover budget is reserved, 20 for the daily discover (window narrowed to 3 days back, 7 ahead, about 42 requests a pass, so a pass about every 3 days, or about daily once backfill is finished and sync can borrow its unused share after 12:00 UTC; each new pass starts looking back from a little before the previous pass began, so nothing that starts between two passes is missed) and 30 for backfill, with leftovers shareable after 12:00 UTC. With Texas only, discover (not syncing) is the bottleneck: about 8 weeks for 12 months until a server-side `addrState` filter is verified at P1-12.

---

## 2026-10-03 — End of session: Phase 1 code complete

**Date:** October 3, 2026

**What changed today (all merged):**

- **Phase 0:** monorepo and CI with the secret scan; database tables; the start.gg client with its rate limiter; the Glicko-2 ranking engine (it passes Glickman's worked example); the app shell and the style guide.
- **Phase 1:**
  - **Data jobs:** find events, pull results, update rankings, and fill in 12 months of history. They run on a GitHub schedule every 2 hours, and hourly from Friday to Monday.
  - **API.**
  - **Website pages:** leaderboard with search, player pages, "How rankings work", and "Data status".
  - **Sentry error alerts.**
  - **Texas only, 16+ entrants** (#20, #21).
- **A start.gg courtesy email** is drafted in `docs/startgg-email-draft.md`, for you to send before sharing the site. Nothing has been sent.
- **Fix found while writing this checklist (in this PR, #22):** the scheduled jobs now create the database tables themselves before running. Without this, the first run against a new Neon database would have failed.

**What's next:** the first live run (P1-12). It needs your setup. Nothing costs money, since everything uses free plans. In order:

1. ☐ **start.gg token:** start.gg → Settings → Developer Settings → create a token. Add it as the GitHub Actions secret `STARTGG_TOKEN` (repo → Settings → Secrets and variables → Actions).
2. ☐ **Neon database (free):** create a project. Copy its connection string and add it as the GitHub secret `DATABASE_URL`.
3. ☐ **Vercel, two projects from this repo (free Hobby plan):**
   - **API:** Root Directory `apps/api`, Framework "Other". Add the settings `DATABASE_URL` (same Neon string) and `ALLOWED_ORIGINS` = the app's full address, starting with `https://`.
   - **App:** Root Directory `apps/app`. Add the setting `EXPO_PUBLIC_API_URL` = the API's full address, starting with `https://`.
   - These settings are read when the site is built, so after adding or changing one, press **Redeploy** on that project.
   - Optional, so PR preview links can load data: `ALLOWED_ORIGIN_PATTERN` on the API project. Tell me the app project's name and I'll give you the exact value to paste.
4. ☐ **Sentry (optional, free):** create a project. Add its DSN as:
   - the GitHub secret `SENTRY_DSN`
   - `SENTRY_DSN` on the Vercel API project
   - `EXPO_PUBLIC_SENTRY_DSN` on the Vercel app project (then Redeploy)
5. ☐ **Claude's cloud environment** (claude.ai → Claude Code → this environment's settings), so Claude can run the live check:
   - allow network access to `api.start.gg`
   - add the same start.gg token as the environment secret `STARTGG_TOKEN`
   - Never paste the token or the database string into chat.

Once 1 and 2 are done, the jobs start on their own schedule. Each run first creates or updates the database tables (safe to repeat), so there's nothing to set up inside Neon. The first history fill starts that night. To start it right away: GitHub → Actions tab → Ingest → "Run workflow", and choose **backfill** in the "Which job to run" list. Then the live check confirms several things:
- how start.gg writes "Texas"
- whether start.gg can filter tournaments by state on its side, which could cut the history fill from about 8 weeks to a few nights
- the disqualification format
- real request counts

**Questions for Clay:**

1. Please work through the setup checklist above when you have time. Tell me when 1, 2 and 5 are done, and I'll run the live check.
2. Should out-of-state players who play enough Texas events appear on the leaderboard? The default is **yes**.
3. Please read the start.gg email draft. Send it when you're ready to share the site.

**Questions for Genghis:** None open. The P1-12 follow-ups are listed at the end of `docs/startgg-notes.md`.

---

## 2026-10-03 — live check is now one command

**Date:** 2026-10-03

**What changed:**

- Added the first start.gg live check as a single command: `pnpm live:check`. It was built and tested with pretend start.gg answers only; it has never touched the real service (this workspace has no token or network access to start.gg).
- It uses about 7 requests (cap 25, plus at most 2 retries), always through our rate-limited client, and never prints the token.
- It answers most of the open questions in plain English: can start.gg filter tournaments by state itself (that could shrink the history fill from about 8 weeks to a few nights), how it spells "Texas" and the country, whether ids are numbers or text, how disqualifications look, whether player profile links are visible, and how many requests the daily discover really needs. It does not answer player location, real error shapes, how set ordering behaves during a live event, or the 7-day cap for events that never finish; those stay on the pending list in `docs/startgg-notes.md`.
- `--out report.md` saves the report. `--record` saves scrubbed copies of the real answers (gamer tags replaced) for future tests.
- Added a short "How to run the live check" section to `docs/startgg-notes.md` and the command to the list in `CLAUDE.md`.

**What's next:**

- Once start.gg network access and the token are added to Claude's environment, run `pnpm live:check -- --out live-check.md`, then fix anything the report contradicts and move the answered items out of "Pending live check".

**Questions for Clay:** Same as above: tell me when setup items 1, 2 and 5 are done and I'll run it.

**Questions for Genghis:** None open.

---

## 2026-10-03 — tournaments now remember their city

**Date:** 2026-10-03

**What changed:**

- We now save the city of each tournament (for example "Austin" or "Houston"). This is groundwork for the Dashboard's "This week's events" list (issue #24), which shows name, city, date, entrants, winner and a start.gg link.
- Discover asks start.gg for the city along with the other tournament details, saves it, and refreshes it if the organizer changes it. Tournaments with no city are saved with it blank.
- The database got one new, empty-by-default "city" column (migration `0001_fast_white_tiger.sql`). It only adds a column, so nothing existing changes. The scheduled job runs migrations first, so the live database picks it up on its own.
- The practice data and test fixtures now have Texas cities. The live check also prints a sample of the cities it sees.
- The start.gg email draft now says "city, state and country".
- Not yet confirmed: that start.gg really offers `city` and fills it in. The name comes from its public documentation, but nobody has tried it against the real service (no network or token here). It is noted as unverified in `docs/startgg-notes.md`.

**What's next:**

- Run `pnpm live:check` once the token is available, to confirm the city field exists and see how it is spelled.
- Build the "This week's events" Dashboard section (issue #24), showing a blank city gracefully.

**Questions for Clay:** None new.

**Questions for Genghis:** If start.gg rejects the `city` field on the first live run, should we drop it or derive the city another way? Default: drop it and show only the state.

---

## 2026-10-03 — two-tab shell (Phase 2, PR 1 of 5)

**Date:** 2026-10-03

**What changed:**

- The public site now has exactly two tabs: **Dashboard** (the home page, still showing the top-100 leaderboard for now) and **Texas** (a placeholder page saying city power rankings are coming).
- On phones the tabs are a bar at the bottom of the screen. On wider screens (768 px and up) they sit in the header. Player pages count as part of Dashboard, so Dashboard stays highlighted there.
- The Style guide link is gone from the header and the Status link is gone from the footer. Those pages, and Methodology, still work at `/style-guide`, `/status` and `/methodology`. The footer keeps one small "How rankings work" link plus the start.gg credit.
- Added the Phase 2 plan in `docs/plans/phase-2-ui.md` (five PRs, plus the defaults for character icons, upset size and week boundaries).
- Updated the browser tests for the new menu and added tests for both tabs, the phone and desktop layouts, and the hidden pages.

**What's next:**

- PR 2: the Texas tab with sample (clearly fake) city scenes, search, pinning and expanding.

**Questions for Clay:** None. The defaults for character icons, upset size and weeks are listed in the plan; tell me if you want any changed.

**Questions for Genghis:** None open.

---

## 2026-10-03 — Texas tab page (city power rankings)

**Date:** 2026-10-03

**What changed:**

- The `/texas` page now lists the five Texas cities with a published local power ranking, using the real lists Clay approved on issue #24: Austin, Dallas-Fort Worth, Houston, Rio Grande Valley and San Antonio. These are the local organizers' rankings, copied in by hand. They are not computed by us and not start.gg data. The page says "Rankings from local organizers" above the list, and the standard footer stays.
- Cities are alphabetical. Tap the star to pin a city to the top (pins are remembered in your browser on the web). Tap a city to open its ranking in place: ranking name, season, a Source link, and the numbered player list, with honorable mentions shown as "HM" at the end. Names are shown exactly as published, sponsor tags included. A search box filters by city.
- Rio Grande Valley and San Antonio are formula-based (Braacket) rankings rather than panel-voted ones, so they carry a small "Calculated ranking" label.
- The whole list comes from one hand-edited file, `data/scenes/texas.json`. A check in the tests rejects bad edits (ranks out of order, repeated city ids, links that are not https, HM entries before numbered ones), so a typo cannot go live. `data/scenes/README.md` explains the file in plain English.
- The page is reached from the Texas tab (two-tab navigation, merged in #27).
- Clay accepted CC BY-SA share-alike for wiki-sourced scene rankings (Oct 4); they are shown with credit. Austin and Dallas-Fort Worth come from Liquipedia and Houston from SmashWiki, so each of those three shows "From <site> · CC BY-SA" next to its Source link when opened. The data check now requires a `credit` on any entry whose link points at liquipedia.net or ssbwiki.com, rejects misspelled keys, and rejects repeated city names. The exact CC BY-SA version still needs confirming from each site's footer; once it is, a License link to that Creative Commons page gets added.

**How a city ranking gets added:** send the list (city, ranking name, season, link to the original post, players in order) to Genghis or Claude. They update `data/scenes/texas.json` in a pull request, and the site updates when it merges.

**What's next:**

- Add more cities as their lists arrive (about 15 are expected at launch).

**Questions for Clay:**

1. Pins are saved per browser on the web only. On the phone apps they will reset when the app closes until we add proper storage. Is that fine for now? (Default: yes.)
2. The source data had no per-city "last updated" date, so none is shown. Do you want one added when you send lists? (Default: no.)

**Questions for Genghis:** None open.

---

## 2026-10-03 — Dashboard data feed (issue #24, part 4 of 5)

**Date:** 2026-10-03

**What changed:**

- Added the data feed for the new **Dashboard** tab: `/v1/dashboard`. Nothing on screen changes yet; the next PR builds the tab itself. It shows "Texas Smash, 2026" plus what happened this week. Every section can be empty, and the tab will show a friendly empty message when it is.
- **What it shows, and how each number is worked out:**
  - **Header:** the year, this week's dates, and "last updated" (the same time as the badge on the leaderboard). "This week" is the same week the rankings use: Monday 00:00 to Sunday 23:59, UTC time. It is worked out from the moment someone opens the page.
  - **Top 10:** the first 10 rows of the leaderboard, with the same score and 7-day change. There is no "main character" because start.gg doesn't give us that.
  - **Biggest movers:** up to 3 ranked players who climbed the most places over 7 days, and up to 3 who fell the most. If two players moved the same amount, the better-ranked one comes first. New players aren't included.
  - **Upsets:** up to 5 sets played this week at counted Texas events where the winner's rating at the start of the week was lower than the loser's. They are sorted by the rating gap, biggest first. Disqualifications and non-counted events are left out. A set is skipped if either player had no rating before this week (a stated default). The row shows both players, the score (like "3-1", or blank if start.gg didn't report one), the event, and the gap.
  - **This week's events:** up to 20 counted Texas events starting this week, in date order, with city (blank if start.gg has none), date, entrants, the winner (blank until there is a 1st place), and a start.gg link.
  - **This year:** counted events since January 1 (UTC), total entrants, how many different players played at least one counted set, the biggest event, and who won the most events. Events later this year that haven't started yet are left out, because their entrant counts are still growing (a stated default).
  - If someone has two linked start.gg accounts, the Dashboard counts them as one player, as the rankings do.
- The practice data now fills every Dashboard section. It is always placed relative to the day it is loaded: two fake events this week ("Sample Weekly" in San Antonio, and "Sample Arcadian" with no city), four upsets, one disqualification that is correctly ignored, and last week's ratings. That keeps automatic tests and screenshots meaningful on any day.
- The "How rankings work" page has a short new "Dashboard numbers" section.
- No database change was needed. The new lookups use indexes that already exist.
- Review follow-ups (same PR):
  - The feed now also says how many events this week matched in total (`weekEventCount`). The list still stops at 20, so the tab can say "and N more".
  - An upset now needs a rating gap of at least 1 after rounding, so the tab never shows "gap 0".
  - If one start.gg account was merged into another more than 5 times in a row (or the links loop), that player is left out of the Dashboard. The player page already answers "not found" for them, so the Dashboard never links to a missing page.
  - New tests load the practice data at two awkward moments (30 seconds after midnight on a Monday, and on New Year's Day 2027, whose week began in 2026) and check that every section still has something in it.
  - The API tests now use a fixed test clock for the Dashboard instead of the real date, so they keep passing after this week ends.
- **Two things to know about "this week":**
  - A preview database is loaded with practice data for the week it was loaded in. From the next Monday on, its "this week" sections (upsets and this week's events) are empty until the practice data is loaded again.
  - Answers are cached for up to about 15 minutes. So for up to about 15 minutes after Monday 00:00 UTC, someone may still see last week's view. (On a quiet page, the first visitor after that can get the old view one more time while the cache refreshes in the background.) Every answer carries its own week dates, so it is never labeled as the wrong week.

**What's next:**

- PR 5 of 5: build the Dashboard tab on top of this feed, with screenshots. Show "and N more" when `weekEventCount` is bigger than the list.

**Questions for Clay:** None new. Two stated defaults you can overrule: (1) "this year" ignores events that haven't started yet; (2) a set doesn't count as an upset if either player had no rating before the week.

**Questions for Genghis:** Upsets use each player's rating at the start of the week (their most recent saved rating from an earlier week). Is that the right "before" rating, or should it be the rating right before the event? The weekly version is simpler and matches how the ratings themselves are worked out.

---

## 2026-10-04 — Dashboard tab (issue #24, part 5 of 5)

**Date:** 2026-10-04

**What changed:**

- The Dashboard tab (the home page, `/`) is built. Top to bottom: a "Texas Smash, 2026" header with the week dates and the "Last updated" badge; the Texas Top 10 (rank, player, score, and change since last week as "▲2", "▼1", "—" or "NEW", read aloud as "up 2", "down 1", "no change", "new"); this week's climbers and fallers; up to 5 upset cards ("Sample_Halo beat Sample_Kite 3–1", the event, and the rating gap); this week's events (with "Winner TBD", a start.gg link that opens in a new tab, and "and N more" if the list was cut off); and "Year at a glance" tiles plus the biggest event and the most event wins.
- Every section has a short friendly message when empty (for example "No upsets yet this week."). While loading it shows grey skeleton bars; if the data cannot load it says so with a "Try again" button.
- There is no main-character icon or text, as agreed (we have no such data).
- **Where the full leaderboard went:** it now lives at its own page, `/leaderboard` (with the player search), reached from "Full leaderboard" under the Top 10. We moved it rather than stacking it under the Dashboard so the Dashboard stays short and quick on phones, and search keeps its own clear page. The Dashboard tab stays highlighted on that page. The existing leaderboard tests now visit `/leaderboard`; nothing in them was loosened.
- New tests: wording helpers (change labels, week range, "and N more", upset sentence) and a full set of browser tests for the Dashboard (sections, links, new tab, empty states, loading, error, no sideways scrolling, accessibility checks).
- Screenshots are in `docs/screenshots/p2-5/` (phone and desktop width).

**What's next:**

- With this, all 5 parts of issue #24 are in: the two tabs, the Texas city rankings (#26), and the Dashboard.
- Next: the first live check against start.gg (P1-12), once the token and network access are set up. Until then, the Dashboard shows the fake sample data.

**Questions for Clay:** None new. Stated default: the page title stays "Dashboard | Smash Ultimate Rankings | Bracket Index".

**Questions for Genghis:** None open.

---

## 2026-10-04 — Demo mode (issue #30)

**Date:** 2026-10-04

**What changed:**

- **What demo mode is:** the app can now run with no API, database or start.gg connected. It answers every page from a small bundled file of fake data (the same `Sample_*` players the practice database and screenshots use). Nothing in it is real start.gg data. The production page at https://smash-rankings-app.vercel.app now shows the full app instead of error messages.
- **A "Demo data" tag** (small yellow skewed label, read aloud as "Demo data: sample rankings, not real results") sits in the header on every page while demo mode is on. It is not there otherwise.
- **How it switches on and off:** it is on when `EXPO_PUBLIC_API_URL` is not set (which is the case on Vercel today), or when `EXPO_PUBLIC_DEMO=1`. To turn it off, set `EXPO_PUBLIC_API_URL` on the Vercel app project to the real API address, then press Redeploy. No code change is needed. (Vercel bakes this value in when it builds, so a Redeploy is required.)
- **Footer credit in demo mode:** the footer says "Sample data, not from start.gg" instead of "Data from start.gg", because the sample players are made up (Genghis's review). The real start.gg credit and link still show whenever the app uses the real API. The bundled file keeps an internal "Data from start.gg" field only because the API's rules require it; it is never shown on screen.
- **No dead start.gg links in demo mode:** sample players have no "View on start.gg" button, and the Dashboard shows no start.gg links for the made-up events (those pages don't exist). Real mode is unchanged.
- **Safer snapshot script** (code review): it only runs against a database on this machine, and refuses if any player (merged ones included) or any Dashboard tournament isn't a `Sample` one. Switching between `dev` and `dev:demo` now clears the build cache, so the app can't get stuck in the wrong mode. In CI the demo browser tests run even when the normal ones fail, so both results show up.
- **The sample data is frozen.** The dates in it (this week, "Last updated") are from the day it was made, so over time the Dashboard will look a bit stale. That is fine for a demo. To refresh it: start a throwaway database, then run `pnpm db:migrate && pnpm db:seed`, then `DATABASE_URL=... pnpm --filter @sr/app demo:snapshot`, and commit `apps/app/src/demo/data.json`. A unit test checks the file against the same rules the real API uses, so a stale or broken file fails the build.
- **One data path:** every page's data goes through one function that picks the bundled data or the network, and both are checked by the same rules. Search works like the API (ignores capital letters, matches anywhere in the name, at most 20 results). An unknown player shows "Player not found". The Texas tab is unchanged.
- **Local development decision:** `pnpm dev` now sets the API address itself (`http://localhost:8787`, or whatever you put in `EXPO_PUBLIC_API_URL` or `API_PORT`). I chose that over keeping a hidden "if in dev, use localhost" fallback in the code, because the fallback could silently hide a missing setting and the code now has exactly one rule for demo versus real. `pnpm --filter @sr/app dev:demo` runs the app locally in demo mode.
- **Vercel check:** the production build was run with no settings at all and works. `dist/player/[idSlug].html` exists, and `cleanUrls` is true, so the `/player/...` rewrite in `apps/app/vercel.json` still matches. We cannot reach vercel.app from here, so this was checked by serving the build with the test server, which copies those rules.
- **Tests:** unit tests for the on/off decision, the demo data (every answer passes its schema, search, unknown player) and the tag. A new small browser test run, `pnpm e2e:demo`, builds the app with no API address into a separate folder (`apps/app/dist-demo`), serves it with no API and no database, and checks the Dashboard, the tag, Texas, search, opening a player, and accessibility. CI runs it right after the normal browser tests, reusing the same job, so it adds about a minute. The normal `pnpm e2e` is unchanged apart from one new check that the tag is absent there.

**What's next:**

- Clay: open https://smash-rankings-app.vercel.app after this merges and redeploys, and look for the yellow "Demo data" tag.
- When the real API is deployed, set `EXPO_PUBLIC_API_URL` on the Vercel app project and Redeploy.

**Questions for Clay:** None. Stated default: the tag text is "Demo data".

**Questions for Genghis:** None.

---

## 2026-10-04 — Refresh button (issue #30, part 2)

**Date:** 2026-10-04

**What changed:**

- **A Refresh button (a small circular arrow) now sits at the top right of the header on every page.** Tapping it reloads the app, which fetches fresh data and the newest version. This matters most on an iPhone with the site added to the Home Screen: there is no browser reload button there, so before this you could not easily pick up a new deploy. On the web it reloads the page. On the phone apps later it will only refetch data, with no reload. Double taps are ignored while a refresh is running. The button is 44 px, has a visible focus ring, and is read aloud as "Refresh". The site has no service worker, so a plain reload always fetches the latest files.
- **A small blue dot appears on the button when a newer version of the site has been deployed**, and its spoken label becomes "Refresh, new version available". Each build gets an id (the Vercel commit id when building on Vercel, otherwise the local git commit, otherwise a timestamp). The build writes it into the app and into a tiny file, `/build-id.json`. When you come back to the page, the app checks that file (at most once every 5 minutes) and shows the dot if the id is different. If the check fails, nothing is shown. In local dev (no build id) it never checks.
- **Build command:** `pnpm --filter @sr/app build:web` now runs `apps/app/scripts/build-web.mjs`, which wraps the same Expo export. It needs no settings, so the Vercel build command is unchanged.
- **Tests:** unit tests for the id comparison and the 5-minute limit. New browser tests check the button at 390 and 1280 px (in the header, 44 px, no sideways scrolling, accessibility clean), that pressing it reloads, and that the dot shows only when the id differs. The demo run also checks the button sits beside the "Demo data" tag without overlap. Screenshots are in `docs/screenshots/p3-refresh/`.

**What's next:**

- Clay: after this merges and deploys, open the site, deploy again, switch back to the tab and look for the dot. Tap Refresh to load the new version.

**Questions for Clay:** None. Stated default: the icon is the text arrow, since no icon library is installed.

**Questions for Genghis:** None.

---

## 2026-10-04 — API deploys on Vercel (issue #33)

**Date:** 2026-10-04

**What changed:**

- **The API now builds in Vercel's own "prebuilt" format, so the deploy no longer fails.** Vercel stopped with "No Output Directory named "public" found" because, with the "Other" preset, it expects a folder of web pages, and the API has none. The API build (`pnpm --filter @sr/api build`, run by `apps/api/scripts/build-vercel.mjs`) now writes a `.vercel/output` folder: one server function holding the whole API, plus a routing file that sends every address to it. Vercel deploys that folder as-is.
- **No source files are served.** The deploy has no static files at all, only the function. Unknown addresses answer "not found" from the API.
- **The health check stays at the API's root address** (`/`). It answers `{"name":"smash-rankings-api","ok":true,...}`.
- **How I checked it:** I ran Vercel's own build tool (`vercel build`, version 62.2.0) locally with the same settings as the Vercel project (root `apps/api`, preset Other). On the old code it fails with exactly the "public" error. On this branch it completes, with one function and no static files. A new CI step loads the built function the way Vercel runs it, sends `GET /` and checks for a 200 answer. It also checks that an unknown address gives a 404. I couldn't deploy to Vercel itself from my sandbox, so the first real deploy happens when this merges.
- **The pnpm "ignored build scripts" warning (esbuild) is harmless.** pnpm installs esbuild's ready-made program as a separate package; the skipped script only double-checks that. The build log shows esbuild running fine.

**What's next:**

- Clay: after this merges, Vercel redeploys the API project by itself. Open the API's address (the "Domains" link on the `smash-rankings-api` project in Vercel). It should show `"ok":true`. Then copy that address into `EXPO_PUBLIC_API_URL` on the **app** project and press Redeploy. That switches the website from demo data to the real API.
- No Vercel setting needs to change. Root Directory `apps/api`, preset "Other", and the build command from `apps/api/vercel.json` all stay as they are.

**Questions for Clay:** None.

**Questions for Genghis:** None.

---

## 2026-10-04 — First backfill loads history (issue #35)

**Date:** 2026-10-04

**What changed:**

- **Backfill now has its own daily allowance for finding tournaments, so Sync can't use it up.** Before, Sync and Backfill shared 50 "discover" requests a day (the requests that list tournaments). From noon UTC, Sync was allowed to use whatever Backfill hadn't. On Oct 4 GitHub started the 07:41 nightly Backfill late, at 13:27. By then the hourly Syncs had used the whole 50, so Backfill found nothing ("0 requests").
- **The new allowances:** Sync gets 50 a day of its own (unchanged, enough for its daily look). Backfill gets 2,000 a day of its own, enough to find about a year of tournaments in one run. Neither can use the other's.
- **Still within start.gg's rules:** every request still goes through our limiter of at most 60 a minute. start.gg allows 80 a minute. The daily numbers only limit how much one day may do.
- **The manual "Run workflow" form is safer:**
  - "months" now stops the run with a clear error if the job isn't backfill. Before, it was silently ignored on a sync run.
  - "months" is now empty by default. Empty means 12.
  - A number outside 1 to 24 also stops the run with an error.
  - The job choice now explains what sync, backfill and rate each do.
- **Rate already runs right after a successful Backfill,** so the Texas Top 10 fills in as soon as enough history is loaded.
- **Tests:**
  - New tests for the exact Oct 4 case (Sync used up its day, then a late Backfill still gets its own allowance).
  - New tests that each job stops at its own cap and that Sync never uses Backfill's.
  - The workflow's job-and-months check was tried with every combination.

**How to run the first backfill (about 5 minutes of clicking, then about an hour of waiting):**

1. On GitHub, open the repo's **Actions** tab, pick **Ingest** on the left, then **Run workflow** (top right).
2. Set **job** to **backfill** and **months** to **6**. Press **Run workflow**. Start it when nothing else is running on the Actions tab (a Sync takes a few minutes). If it later shows **cancelled**, a scheduled Sync took its place in the queue: just run it again.
3. It runs for up to 75 minutes. When it finishes, **Rate** runs by itself. Open the Rate step's summary to see the top 20.
4. If the Backfill summary says "stopped early: resumes next run", run it again the same way. It continues where it left off. The nightly backfill also continues it.
5. Later, if you want more history, run backfill again with a larger months value (up to 24). Months already done are skipped.

**What's next:**

- Clay: run the first backfill as above, then check the Dashboard's Texas Top 10. A player is ranked only after 10 rated sets at 3 or more qualifying events, with an uncertainty (RD) of 110 or lower. That is why 6 months of history matters.
- If 6 months still leaves the Top 10 short, run backfill with months = 12.

**Questions for Clay:** None. Stated default: Backfill may use 2,000 tournament-listing requests a day. The real limit is start.gg's 80 a minute, and we stay at 60.

**Questions for Genghis:** This replaces your 50-a-day shared rule with separate caps (Sync 50, Backfill 2,000), as issue #35 asks. Is 2,000 a day for Backfill acceptable, given every request stays at or under 60 a minute?
