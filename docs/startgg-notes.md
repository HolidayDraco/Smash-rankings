# start.gg API notes

Status of what we know about the start.gg API. Items marked "pending live check" were
written from memory of the public docs and must be confirmed with a real token.

## Schema source

`packages/startgg/schema/startgg.graphql` is a **trimmed, hand-written** schema, not the real one.
No public copy was findable, and the build sandbox blocks api.start.gg and developer.start.gg
and has no token. Replace it with the real schema:

1. Add `api.start.gg` (and `developer.start.gg`) to the Claude cloud environment's **Custom network access** list. Clay needs to do this; without it no live call can work from the sandbox.
2. `STARTGG_TOKEN=... pnpm --filter @sr/startgg schema:pull`
3. `pnpm codegen`, then fix any query or Zod schema the compiler flags (the Zod schemas are compile-checked against the generated types).

## Verified (from the official docs and examples, [SG2] [SG3] in the blueprint)

- Endpoint `https://api.start.gg/gql/alpha`, header `Authorization: Bearer <token>`.
- Ultimate videogame id is 1386.
- Limits: 80 requests per 60 s on average, 1,000 objects per request. Errors: "Rate limit exceeded - api-token", "Query complexity too high".
- Tournaments query by `videogameIds` with `afterDate`/`beforeDate`, `sortBy: "startAt asc"`.
- Per-slot score is `slots.standing.stats.score.value`.

## How to run the live check

Needs `STARTGG_TOKEN` and network access to `api.start.gg`. It uses about 7 requests. The cap is 25 (`--max-requests`, 1 to 50), plus at most 2 retries of the last call (the script allows 3 attempts per call). A typical run: 1 introspection, 1 tournaments page, 1 state-filter probe (only if the filter exists), 2 sets pages (first and last), 1 unfiltered set count, 1 standings page. If no Texas event is on the first page it reads up to 5 more tournament pages.

```
STARTGG_TOKEN=... pnpm live:check -- --out live-check.md
```

- `--out` is relative to the folder you typed the command in. `--event <id>` checks a specific event instead of picking one. `--record` saves scrubbed raw responses to `packages/startgg/fixtures/live/` (`pnpm --filter @sr/startgg fixtures:record` is the same thing). Gamer tags become `Player <id>`, prefixes and user slugs are blanked; check the files before committing. Exit code 2 means some step errored (the report lists them); 1 means bad arguments or no token.
- **It answers:** whether `TournamentPageFilter` has `addrState` / `countryCode` filters (and the Texas count and request cost if so); `SetFilters` `updatedAfter` and `state`; the real `addrState` / `countryCode` values and how many our region rule accepts; the discover request count for the real window (14 days back, 30 ahead), which answers (d); a tally of `Event.type` with team roster size; number vs string ids; for one completed Texas 16+ singles event, completed vs unfiltered set totals (a), DQ signals on the first and last sets pages (b), `Player.user.slug` visibility (c), standings total, and rough objects per page.
- **It does NOT answer:** player location (`Player.user.location`), the real error shapes (they only appear if an error happens; the report shows any that do), the Event `sets` sort behaviour during a live event, and (e) the 7-day cap for never-COMPLETED events.
- Afterwards, move each answered item below out of "Pending live check" and fix any code it contradicts.

## Pending live check

- **Error shapes.** We match on message text (`rate limit exceeded`, `complexity`, `invalid authentication token`) and HTTP 429/401/403/5xx. Real bodies may differ slightly. Fixtures `error-*.json` are guesses.
- **DQ encoding.** We treat `displayScore == "DQ"` or any slot score of -1 as a DQ. Unverified; start.gg may also use `winnerId` null, or a set `state`.
- **Event type.** We assume `Event.type` 1 = singles, 5 = teams, and fall back to `teamRosterSize`.
- **Set filter for state.** `filters: { state: [3] }` for completed sets (3 = completed) is assumed.
- **"Updated after" set filter.** Not used. If `SetFilters.updatedAfter` exists it would let the re-sync job fetch only changed sets. Check by introspection.
- **Player location.** Not queried. We believe `Player.user.location { country state }` and `Participant.user` exist, but whether they are public and filled in is unknown. The blueprint's `players.country_code/region` columns depend on this.
- **ID types.** Codegen treats `ID` as a JSON number (docs examples show `"id": 1386`). If real ids come back as strings, the Zod schemas will reject them loudly.
- **Event `sets` sort.** We use `RECENT` so new sets land on early pages. During a live event pages shift, so the client de-duplicates by id and the sync job should re-run until stable.
- **(a) Sets `total`.** Does `pageInfo.total` for sets filtered by `state: [3]` count only completed sets? The stale-row delete in sync depends on it (a larger total than the rows we see blocks the delete).
- **(b) DQ sets with no `completedAt`.** Are they dropped? If start.gg leaves `completedAt` null on DQs, they never reach the database.
- **(c) `Player.user.slug`.** Is it visible to our token? (`players.user_slug` stays empty if not.)
- **(d) Real discover request count** versus the 50-requests-a-day rule (Genghis). Until measured, the cap is checked after every page (`discoverWindow` `maxRequests`), so backfill can overshoot by at most the retries inside one page (see the backfill estimate below).
- **(e) 7-day cap for never-COMPLETED events.** Is it right? Some events may never reach `COMPLETED`; after 7 days sync treats them as finished.
- **Objects per page.** Estimates: about 14 objects per set (40 sets = 560), 4 per standing (100 = 400), about 20-60 per tournament (20 = 400-1,200, shrinks automatically if too complex). Measure live and tune the defaults in `client.ts`.

## Request budget

At the defaults, a 2,000-entrant double-elimination event (about 4,000 sets) is about 100 set pages plus 20 standings pages, so about 120 requests (about 2 minutes at 60 requests a minute). Discovery: see below.

## Normalized set conventions

- DQ sets: `isDq = true`, games `null`. A finished set with no score also has null games.
- Sets are dropped when either side is not a single named player (teams, no gamer tag) or both sides are the same player.
- `User.slug` (public profile slug) is requested for `players.user_slug`. Pending live check: that `Player.user` is exposed with a token.
- Rate-limit errors back off from 10 s (or `Retry-After` if sent); other transient errors from 1 s.

## Discover job request estimate (P1-1)

`jobs/src/discover.ts` pages `tournaments` (videogame 1386) over the last 14 plus next 30 days, 20 tournaments per page, so **requests per run = ceil(tournaments in the window / 20)**. Nothing else is requested.

- Fixtures: 3 tournaments in 2 pages (the fixture's `totalPages`), which is the dry-run sample (2 requests).
- Live: **not measured.** The number of Ultimate tournaments listed on start.gg in a 44-day window (locals and online weeklies included, because the tournaments query cannot filter by size) is unknown. The 50-request daily target holds only up to about 1,000 tournaments in the window. A 44-day window with every local on start.gg may well exceed that.
- If the first live dry run shows more than 50: (1) raise `DEFAULT_TOURNAMENTS_PER_PAGE` if the objects-per-request measurement allows it; (2) scan the full window weekly and only the last 3 plus next 30 days daily. P1-12 should record the real number.
- The job writes each page as it goes and is safe to rerun, so a time-budget stop (reported as status `partial`) loses nothing.

Signals still pending a live check, each in one function in `packages/core/src/qualifying.ts`: `isSinglesEvent` (Event.type 1) and `isOnlineEvent` (event flag, then tournament flag; unknown counts as in person).

### Region rule (ADR-0003)

- Only tournaments in a launch region are stored: `LAUNCH_REGIONS` in `packages/core/src/constants.ts` (US, state TX). `classifyEvent` is the single place that decides; events outside the region are "skip" (not stored; an already-stored one is demoted when discover next sees it). Online events have no state, so they skip too, unless their tournament is tagged with a Texas state, in which case they stay "stored-not-qualifying".
- The field we read is `Tournament.addrState` (with `Tournament.countryCode`). The check is case-insensitive and accepts "TX" or "Texas"; a null country relies on the state alone.
- **Request cost of discover is unchanged by the region rule.** It still pages every Ultimate tournament nationwide and filters locally.
- **City (added for the Dashboard "This week's events" list, issue #24):** we also read `Tournament.city` (a nullable string) and store it in `tournaments.city`; it is shown next to the event name. It is public tournament info and we display it, so it fits "minimum data". ⚠ Unverified: it comes from start.gg's public schema docs, not from a live query (no network or token in the sandbox). Whether it is filled in for most Texas tournaments, and how it is spelled ("Austin" vs "Austin, TX"), is unknown. `pnpm live:check` now reports a sample of `city` values and how many launch-region tournaments have none. A null city is stored as null and the UI must cope with that.
- ⚠ Unverified (P1-12 live check): whether `addrState` holds "TX" or "Texas" (or something else, such as a lowercase or padded value).
- ⚠ Unverified (P1-12): the `countryCode` format. We expect "US". If it is something else (e.g. "USA"), every Texas event would be skipped, so discover's summary reports "N outside the launch region" separately: check it on the first live run.
- **Changing `LAUNCH_REGIONS`:** sync, rate and the API trust `events.qualifies`. Discover only re-classifies events in the window it reads (14 days back to 30 ahead), so after adding or removing a state, run discover once over the last 12 months (`--from`) so every stored event is re-checked.
- ⚠ Unverified (P1-12): whether `TournamentPageFilter` has server-side `addrState` / `countryCode` filters. Our trimmed schema does not include them. If they exist, using them would cut discover requests sharply; keep the local check as a backstop.

### Discover: reruns, stale flags, and slug clashes

- Tournaments are paged by `startAt`, so pages can shift while the run is going (a tournament added mid-run). The daily rerun catches anything missed.
- If a stored event now classifies as skip (fewer than 16 entrants, switched to doubles, tournament outside the launch region), its `qualifies` is set to false and `num_entrants` refreshed. Only existing rows are updated; skipped events are never inserted.
- `tournaments.slug` and `events.slug` are unique, but a recreated tournament or event arrives with a new id and the old slug. Before upserting, the old row keeps its data and its slug is renamed to `<slug>~stale-<oldId>`. That cannot clash again, so the run neither fails nor loops, and nothing is deleted.

## Sync job (P1-2)

`jobs/src/sync.ts`. Only events with `qualifies = true` are ever requested (also with `--event`, which refuses others with exit 2). Online events stay metadata only.

**Player fields stored (minimum data):** `id` (start.gg player id), `gamer_tag`, `prefix`, `user_slug` (public profile link). `country_code` and `region` are not filled: the location fields are not verified yet. A refreshed tag always overwrites; a null prefix or slug never erases a stored value.

**Which events are picked:** `qualifies`, `start_at` in the past, and one of: (1) status pending or partial, always; (2) `done` and due its single re-check: `last_synced_at < start_at + 48 h` and `now > start_at + 72 h` (the re-check sets `last_synced_at` past that 48 h mark, so it fires exactly once); (3) `error`, but only 24 h after the last attempt. A failed event records its attempt time in `last_synced_at`. Served in that order (so failing events cannot starve new ones), then least recently synced, then oldest start, at most 25 per run (`MAX_EVENTS_PER_RUN`).

**Live versus finished events:** an event whose stored `state` is not `COMPLETED` (and that started less than 7 days ago; after that it counts as finished, because discover stops refreshing `state` after 14 days) is fetched from page 1 every run, any cursor is dropped (none is saved), and it is never marked `done`: it stays `partial`. That keeps a live weekend fresh. Trade-off: every run re-fetches every live event in full (about 4 to 16 requests each), until start.gg reports it COMPLETED or 7 days pass. Once COMPLETED, one full pass marks it `done`; the cursor is only used to resume within that pass. A pass that started at page 1 also deletes this event's sets and standings it did not see (a set removed or reopened upstream), in the same transaction that marks the event done; a pass that resumed from a cursor does not delete. Neither does a pass that saw no rows, or fewer rows (items plus skipped) than `pageInfo.total` of the last page (or when the total is missing): that is more likely an early end or an upstream glitch. Sets and standings are checked separately. The one re-check of a `done` event never reads or saves a cursor: it is always a full pass from page 1 within one run. If the time budget interrupts it, the event is left `partial` (still eligible) and the next run starts it over; it is only marked `done` when a pass finishes.

**Per page:** sets are fetched 40 per page (completed only). Players, sets, and the `events.sync_cursor` checkpoint (`{"page","perPage"}`) are saved in one transaction. Standings follow (100 per page); standings for a player we never saw in a set are skipped and counted. On the last sets page the cursor keeps pointing at that page, so a stop during standings redoes one page only.

**Request estimate:** per event, `ceil(sets / 40) + ceil(entrants / 100)`. A 64-entrant event has about 120 sets, so about 3 + 1 = 4 requests (a 16-entrant local is about 30 sets, so 1 + 1 = 2); a 256-entrant event about 500 sets, so about 13 + 3 = 16. A run of the full cap of 25 events is therefore roughly 100 to 400 requests, about 2 to 7 minutes at the 60 requests per minute limit. The one re-check costs the same as a first sync, and each live event costs that again every run. Not measured live.

## Backfill (P1-3)

`jobs/src/backfill.ts` covers the current month plus the 12 before it (`--months`, max 24), newest first. Per month it runs discover over that calendar month, then syncs that month's qualifying events (online events are never synced). `meta.backfill_cursor` holds the start of the oldest finished month; a run ends at 75 minutes and the next night resumes. Once the target is reached the job is a no-op.

**Estimate (guesses, not measured live; Texas, 16+ entrants per ADR-0003):** about 125 discover requests a month (discover still lists every Ultimate tournament, about 2,500, and keeps the Texas ones), and perhaps 40 to 80 qualifying Texas events a month at about 2 to 4 requests each (about 100 to 300). So event syncing for 13 months is only about 1,300 to 4,000 requests (well under an hour in total). **Discover is the bottleneck, not syncing.**

**The 50 requests a day discover cap is enforced and reserved** (`jobs/src/discover-budget.ts`). The day (UTC) is split so neither job starves the other: the daily discover inside sync gets 20 (`SYNC_DISCOVER_SHARE`) and backfill gets 30 (`BACKFILL_DISCOVER_SHARE`). From 12:00 UTC either may also use what the other left unused. The total never passes 50. `meta.discover_day` holds the UTC date and `meta.discover_day_requests_sync` / `_backfill` what each spent that day (written in one transaction, and also when discover throws). A window cut short is not lost:

- Backfill saves `meta.backfill_discover_cursor` (`{from, cursor}`, after every page, or `{from, done}` once a month's discover finished but its events are not all synced) and continues at that page next time.
- Sync's discover saves `meta.sync_discover_cursor` (`{from, to, cursor}`, after every page) and continues the same window. A cut-short run is recorded `partial`, so it counts as not done.
- When a job has nothing left today it skips discover (sync still syncs known events).

**The daily discover is narrow:** the last 3 days plus the next 7 (`DAILY_DISCOVER_DAYS_BACK/AHEAD`). The manual `pnpm job:discover` keeps 14 / 30. Events further out are found when they enter the 7-day window, early enough because sync only fetches events that have started.

**Estimates with the reserve (guesses, not measured):** at about 125 discover requests a month (about 2,500 tournaments, 20 a page), a 10-day window is about **42 requests a pass**. At 20 a day that is a pass about every 3 days (the 24 h gate then waits for the next day), and about daily once backfill has finished and sync can borrow backfill's unused share after 12:00 UTC. That is fine for "last updated" on discovery. In plain English: each new pass starts looking back from a little before the previous pass began (whichever is earlier: 3 days back, or 6 hours before the last pass started, but never more than 14 days back), so a tournament that starts between two passes is still caught after it has started. Backfill at 30 a night needs about 4 nights per month, so 13 months is about 55 nights, **about 8 weeks (roughly 2 months)**. Event syncing for Texas fits easily. Both depend on the real count (item (d)). Two things shorten this a lot after the live check: a server-side `addrState` filter on `tournaments` (⚠ unverified; Texas alone is likely well under 200 tournaments a month, so about 10 requests a month and the full 13 months in a few nights), or raising the cap (at 125 a day, 13 months is about 2 weeks).

**Month boundaries.** Discover windows select by tournament start, backfill sync windows by event start. A tournament in month M can have an event starting a few days into M+1. Backfill goes newest first, so M+1 is done before M's tournaments are known: therefore month M's sync window extends 7 days past its end, and the regular sync covers anything starting in the last 14 days (and serves older pending events last, so they are not stranded).

**Regular sync and old events.** Pending events that started more than 14 days ago are served last (after fresh and live events, re-checks and error retries); backfill normally gets them first.

Neon compute hours (100 CU-hours a month on the free plan) cannot be queried from SQL. Check the Neon console by hand. The rate job's summary shows database size and warns at 70% of 1 GB.

**Deferred to the live check (P1-12):** S1: move backfill after 12:00 UTC so it can borrow sync's leftover share (about 20% faster). S3: re-read one page before the saved cursor on resume. S4: capture `now` once for the day's budget accounting. Also: once the discover cap is raised and backfill runs long, the 08:23 and 09:23 syncs can queue behind it and one may be replaced, which is a missed Sentry check-in; Sentry's `failureIssueThreshold` of 2 tolerates one.
