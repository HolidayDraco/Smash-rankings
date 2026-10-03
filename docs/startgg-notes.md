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

At the defaults, a 2,000-entrant double-elimination event (about 4,000 sets) is about 100 set pages plus 20 standings pages, so about 120 requests (about 2 minutes at 60 requests a minute). Discovery of a 14-day window is a handful of requests.
