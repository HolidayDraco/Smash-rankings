# ADR-0003: Launch scope is Texas only, events with 16+ entrants

**Status:** Accepted, October 3, 2026
**Deciders:** Clay (product owner), confirmed in the build session on Oct 3, 2026
**Amends:** blueprint decision 2 (was ≥ 64 entrants, nationwide) and [ADR-0002](0002-ranking-method.md) §Context. Adds blueprint decision 9.

## Context

The original plan ranked every in-person Smash Ultimate singles event on start.gg with at least 64 entrants, nationwide. Clay changed the launch goal: **ship a Texas phone app first**. A Texas-only list needs Texas locals to count, and most of them are well under 64 entrants.

## Decision

1. **Region:** only tournaments held in **Texas** are ingested and rated. The region is a setting, `LAUNCH_REGIONS = ["TX"]` in `packages/core`, not logic spread through the code. Adding a state later is a one-line change, plus a backfill run.
2. **Entrant cutoff:** in-person **singles** events with **16 or more entrants** qualify (was 64). Online events are still never rated (decision 3 unchanged).
3. **Who appears:** everyone who plays sets at qualifying Texas events is rated. The leaderboard uses the same eligibility rules as before (≥ 10 rated sets, ≥ 3 qualifying events, RD ≤ 110, last 52 weeks). In practice that means Texas regulars. A visitor from another state who attends enough Texas events would appear too. *Stated default; Clay can ask for a "Texas residents only" rule later.*
4. **Unchanged:** Glicko-2 settings, weekly periods, the conservative score, and the 12-month window. Our Glicko-2 ranking stays the main ranking.
5. **Next phase, not now:** a federation-rankings tab, user logins, and admin users.

## How the region is checked

start.gg tournaments carry an address. The tournament's state field (`addrState`) is the planned filter, and the `tournaments` query may support a location filter server-side, which would cut requests. **⚠ Unverified** until the live check (P1-12): the exact field name, whether it holds "TX" or "Texas", and whether the server-side filter exists. The client-side check accepts both spellings, and what we find gets recorded in `docs/startgg-notes.md`.

## Consequences

- **More, smaller events.** A 16-entrant local has about 30 sets, one or two pages, so each event is cheap to sync. But there are many more of them. The request-budget math in the scheduled-jobs PR (#16) is re-checked against this, staying ≤ 60 requests per minute and within the shared daily discover budget.
- **Faster settling.** Locals give players many more sets, so ratings settle sooner and more players reach the leaderboard.
- **Copy changes.** `docs/METHODOLOGY.md` and the in-app methodology page say "Texas" and "16+". A unit test keeps the two identical.
- **The old national data model still fits.** Tournaments already store `region`, so nothing in the database schema needs to change.
