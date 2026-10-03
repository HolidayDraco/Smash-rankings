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

## Pending live check

- **Error shapes.** We match on message text (`rate limit exceeded`, `complexity`, `invalid authentication token`) and HTTP 429/401/403/5xx. Real bodies may differ slightly. Fixtures `error-*.json` are guesses.
- **DQ encoding.** We treat `displayScore == "DQ"` or any slot score of -1 as a DQ. Unverified; start.gg may also use `winnerId` null, or a set `state`.
- **Event type.** We assume `Event.type` 1 = singles, 5 = teams, and fall back to `teamRosterSize`.
- **Set filter for state.** `filters: { state: [3] }` for completed sets (3 = completed) is assumed.
- **"Updated after" set filter.** Not used. If `SetFilters.updatedAfter` exists it would let the re-sync job fetch only changed sets. Check by introspection.
- **Player location.** Not queried. We believe `Player.user.location { country state }` and `Participant.user` exist, but whether they are public and filled in is unknown. The blueprint's `players.country_code/region` columns depend on this.
- **ID types.** Codegen treats `ID` as a JSON number (docs examples show `"id": 1386`). If real ids come back as strings, the Zod schemas will reject them loudly.
- **Event `sets` sort.** We use `RECENT` so new sets land on early pages. During a live event pages shift, so the client de-duplicates by id and the sync job should re-run until stable.
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

### Discover: reruns, stale flags, and slug clashes

- Tournaments are paged by `startAt`, so pages can shift while the run is going (a tournament added mid-run). The daily rerun catches anything missed.
- If a stored event now classifies as skip (fewer than 64 entrants, switched to doubles), its `qualifies` is set to false and `num_entrants` refreshed. Only existing rows are updated; skipped events are never inserted.
- `tournaments.slug` and `events.slug` are unique, but a recreated tournament or event arrives with a new id and the old slug. Before upserting, the old row keeps its data and its slug is renamed to `<slug>~stale-<oldId>`. That cannot clash again, so the run neither fails nor loops, and nothing is deleted.

## Sync job (P1-2)

`jobs/src/sync.ts`. Only events with `qualifies = true` are ever requested (also with `--event`, which refuses others with exit 2). Online events stay metadata only.

**Player fields stored (minimum data):** `id` (start.gg player id), `gamer_tag`, `prefix`, `user_slug` (public profile link). `country_code` and `region` are not filled: the location fields are not verified yet. A refreshed tag always overwrites; a null prefix or slug never erases a stored value.

**Which events are picked:** `qualifies`, `start_at` in the past, and one of: (1) status pending or partial, always; (2) `done` and due its single re-check: `last_synced_at < start_at + 48 h` and `now > start_at + 72 h` (the re-check sets `last_synced_at` past that 48 h mark, so it fires exactly once); (3) `error`, but only 24 h after the last attempt. A failed event records its attempt time in `last_synced_at`. Served in that order (so failing events cannot starve new ones), then least recently synced, then oldest start, at most 25 per run (`MAX_EVENTS_PER_RUN`).

**Live versus finished events:** an event whose stored `state` is not `COMPLETED` (and that started less than 7 days ago; after that it counts as finished, because discover stops refreshing `state` after 14 days) is fetched from page 1 every run, any cursor is dropped (none is saved), and it is never marked `done`: it stays `partial`. That keeps a live weekend fresh. Trade-off: every run re-fetches every live event in full (about 4 to 16 requests each), until start.gg reports it COMPLETED or 7 days pass. Once COMPLETED, one full pass marks it `done`; the cursor is only used to resume within that pass. A pass that started at page 1 also deletes this event's sets and standings it did not see (a set removed or reopened upstream), in the same transaction that marks the event done; a pass that resumed from a cursor does not delete. Neither does a pass that saw no rows, or fewer rows (items plus skipped) than `pageInfo.total` of the last page (or when the total is missing): that is more likely an early end or an upstream glitch. Sets and standings are checked separately. The one re-check of a `done` event never reads or saves a cursor: it is always a full pass from page 1 within one run. If the time budget interrupts it, the event is left `partial` (still eligible) and the next run starts it over; it is only marked `done` when a pass finishes.

**Per page:** sets are fetched 40 per page (completed only). Players, sets, and the `events.sync_cursor` checkpoint (`{"page","perPage"}`) are saved in one transaction. Standings follow (100 per page); standings for a player we never saw in a set are skipped and counted. On the last sets page the cursor keeps pointing at that page, so a stop during standings redoes one page only.

**Request estimate:** per event, `ceil(sets / 40) + ceil(entrants / 100)`. A 64-entrant event has about 120 sets, so about 3 + 1 = 4 requests; a 256-entrant event about 500 sets, so about 13 + 3 = 16. A run of the full cap of 25 events is therefore roughly 100 to 400 requests, about 2 to 7 minutes at the 60 requests per minute limit. The one re-check costs the same as a first sync, and each live event costs that again every run. Not measured live.
