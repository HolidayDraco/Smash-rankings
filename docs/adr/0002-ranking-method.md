# ADR-0002: Ranking method (Glicko-2 on sets, weekly periods)

**Status:** Accepted, October 3, 2026
**Deciders:** architect subagent, under Clay's locked blueprint decisions 2–5
**Changes to this method require a new ADR.** Event scope (which events count) amended by [ADR-0003](0003-texas-launch-scope.md): Texas only, 16+ entrants.

## Context

Clay locked these choices: count singles events with **≥ 64 entrants** (decision 2), **in person only**, with online events stored but not rated (decision 3), a **Glicko-2 skill rating** (decision 4), and **12 months** of live data (decision 5). The blueprint's research (§2.3) recommends specific settings. This ADR records them in one place so `packages/ranking`, the rate job, and `docs/METHODOLOGY.md` all agree.

Plain-English terms:
- **Rating (r):** our best guess of a player's skill. Everyone starts at 1500.
- **Rating deviation (RD):** how unsure we are about that guess. It's high for new or inactive players and shrinks as they play.
- **Volatility (σ):** how much a player's results tend to swing.
- **Rating period:** a time window in which all sets are treated as played at the same moment.

## Decision

1. **Algorithm:** Glicko-2 exactly as in Glickman's "Example of the Glicko-2 system" [R1], implemented in pure TypeScript in `packages/ranking`. It has no database, network, or clock access, and the same input always gives the same output.
2. **Starting values:** r = 1500, RD = 350, σ = 0.06. System constant **τ = 0.5** (the paper calls 0.3–1.2 reasonable). The volatility update uses the **Illinois algorithm** with convergence tolerance **ε = 0.000001** (1e-6).
3. **What's rated:** **sets, not games.** A set win scores 1 and a loss scores 0. Game counts are stored for display only. **DQs and forfeits are excluded.** So are sets missing a start.gg player on either side, and sets where both sides resolve to the same player after alias merges.
4. **Rating periods:** **one ISO week in UTC** (from Monday 00:00 up to, but not including, the next Monday 00:00). Within a week, every set uses opponents' ratings from the start of that week, as Glicko-2 requires. A previously rated player with no sets that week only gets the RD-growth step. The current, unfinished week is rated with the sets so far and recomputed on every run, which is what makes it feel live.
5. **Which events count:** Super Smash Bros. Ultimate (videogame 1386), **singles**, **in person**, **≥ 64 entrants** [U1] *(amended by ADR-0003: ≥ 16 entrants, Texas only)*. Online events are stored with `qualifies = false` and never rated. Rules live in `packages/core`.
6. **Leaderboard order:** **conservativeScore = r − 2·RD**, the low end of the 95% range [R1]. Ties break by higher r, then lower start.gg player id, so the order is stable.
7. **Eligibility to appear on the leaderboard,** all of these in the **trailing 12 months** from the run's "as of" date: **≥ 10 rated sets**, **≥ 3 qualifying events**, and **RD ≤ 110**. Thresholds are constants in `packages/core` and can be tuned with a new ADR.
8. **Window:** ratings are computed from the first week of the 12-month window, and everyone starts fresh at that point. When history is backfilled to 24 months (decision 5), the extra year is used for display (results, head-to-head) and Phase 2 backtests only. The rating start point stays at 12 months. Moving it back would change everyone's numbers, so it needs Clay's call and a new ADR.
9. **Mandatory test:** the paper's worked example (player 1500/200/0.06 against 1400/30, 1550/100, 1700/300 with results W, L, L, τ = 0.5) must match the paper's printed **r′ 1464.06, RD′ 151.52, σ′ 0.05999** within the paper's own precision (|Δr′| < 0.01, |ΔRD′| < 0.01, |Δσ′| < 0.00001). The paper rounds intermediate values (μ′ = −0.2069), so full precision gives 1464.0507 / 151.5165 / 0.059996. The test also asserts those exact values tightly, so a correct engine passes and a wrong one can't hide.
10. **RD ceiling:** none for now, following the paper. A long-inactive player's RD can drift above 350. They can't be ranked anyway (RD ≤ 110), so this only affects their own page. Revisit in the Phase 2 backtests.

## Alternatives considered

- **Elo:** simple, but it has no uncertainty and no inactivity handling, so new and returning players get mis-ranked [blueprint §2.3].
- **OpenSkill / TrueSkill-style (Weng-Lin):** MIT-licensed and patent-free [R2][R3]. Its strength is team and multiplayer matches. For 1v1 it behaves much like Glicko. It stays a Phase 2 backtest candidate.
- **UltRank-style points (iterative averaging + tournament tiers):** the community standard [U1][U2], but it has many hand-tuned parts, its scoring code has no license [U5], and it updates twice a year, not after every event.
- **Monthly rating periods:** fewer, larger periods. This is the fallback if weekly turns out too noisy in Phase 2 backtests.
- **Rating games instead of sets:** this over-weights long sets and doesn't match how the community judges results.

## Consequences

- Rankings can update after every sync, within about 1–2 hours of sets finishing on weekends (decision 6).
- The conservative score keeps one-event wonders from jumping to #1. A newcomer must play enough for RD to drop.
- Results won't match UltRank exactly. The methodology page says so and links to UltRank as the community ranking.
- Recomputing the full 12 months on every run is simple and deterministic. If it gets slow, an incremental recompute from the earliest changed week is an optimization, not a method change.
- τ, the eligibility thresholds, and the period length get tuned only through Phase 2 backtests (log-loss vs. Elo and OpenSkill) and a new ADR.
- If DQ encoding on start.gg turns out different from our assumption (pending live check), only the DQ-detection function changes, not this method.

## Sources

- [R1] Glickman, "Example of the Glicko-2 system" — http://www.glicko.net/glicko/glicko2.pdf
- [R2] openskill.js (MIT) — https://github.com/philihp/openskill.js
- [R3] "Openskill vs TrueSkill Implementations" — https://www.philihp.com/2020/openskill.html
- [U1] SmashWiki: UltRank (64-entrant minimum, weeklies excluded) — https://www.ssbwiki.com/UltRank
- [U2] Stuart98, "The LumiRank Algorithm, and How We Got Here" — https://medium.com/@Stuart98SSB/the-lumirank-algorithm-and-how-we-got-here-01ca23ac4122
- [U5] kenniky/ultrank-scoring (no license) — https://github.com/kenniky/ultrank-scoring
- `docs/blueprint.md` "Decisions locked" 2–5 and §2.3; `.claude/agents/ranking-engine.md`
