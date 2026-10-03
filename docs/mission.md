# Mission: kickoff prompt (paste this into a new Claude Code cloud session)

> **Already in the repo:** `CLAUDE.md` at the root, `docs/blueprint.md`, `docs/mission.md` (this file), `STATUS.md` at the root, and the six subagents in `.claude/agents/`. Do not move them. Make sure the cloud environment has **Custom** network access including `api.start.gg` and the start.gg token stored as an API credential (see `docs/blueprint.md` §4, Phase 0).

---

You're the lead engineer on **Smash Rankings**, an unofficial fan web app showing live Super Smash Bros. Ultimate player rankings computed from start.gg data. It must later ship as an iOS/Android app from the same codebase. I'm Clay, the owner. I'm not an engineer, so explain things in plain English and steer me with clear choices.

**Read first, in this order:** `CLAUDE.md`, then `STATUS.md`, then `docs/blueprint.md` (the full architecture, research, phases, and decisions), then `docs/mission.md`, then the files in `.claude/agents/`.

**Your job in this session: Phase 0 (Setup), then start Phase 1 (MVP web).** Planning docs are loaded. Phase 0 application work has not started.

1. **Plan files are already in place.** `CLAUDE.md` stays at the repo root. The blueprint is `docs/blueprint.md`. This prompt is `docs/mission.md`. Subagents live in `.claude/agents/`. The running log is `STATUS.md` (repo root, not `docs/`). The eight recommended defaults are locked at the top of `docs/blueprint.md`. Create `docs/adr/` when you write the first ADR. Do not open another housekeeping PR to move these files.
2. **Plan before building:** use the `architect` subagent to write `docs/plans/phase-0.md` and `docs/plans/phase-1.md`. Each lists small PRs with scope, the subagent that builds it, tests, and a plain-English acceptance checklist I can check from my phone. The decisions at the top of `docs/blueprint.md` are already locked (defaults 1–7 as recommended; decision 8 is the Oct 3, 2026 white light theme in **Design principles**). Use them and note that in the plan. Don't wait for another answer on those eight.
3. **Build Phase 0** as separate small PRs: monorepo scaffold (pnpm + Turborepo, strict TS, ESLint/Prettier, gitleaks) and CI; Drizzle schema + first migration for Neon; `packages/startgg` with codegen, the ≤ 60 req/min limiter, and recorded fixtures; `packages/ranking` Glicko-2 passing Glickman's worked example; the Expo Router app shell deployed to Vercel (the SSR spike, falling back to static output if it can't be made to work within one PR, explained in an ADR); ADR-0001 (stack) and ADR-0002 (ranking method).
4. **Then Phase 1**, one PR per milestone: discover → sync/backfill (12 months) → rate job → leaderboard page → player page → methodology + attribution + status page → Sentry.
5. **Every PR** follows the CLAUDE.md Definition of Done: CI green, Vercel preview link, mobile screenshots, test evidence, a plain-English summary, a phone-friendly checklist of what to look at in the preview, and an ☐ acceptance checklist. Read and respond to PR comments from me and from Genghis (my advisor bot). Run the `code-reviewer` subagent in `.claude/agents/code-reviewer.md` before marking a PR ready. **Once tests and review pass, merge the PR yourself.** That includes every PR, including the style guide page. Do not wait for my approval. Keep going on the next PR. Update `STATUS.md` in the same PR.
6. **Hard rules:** never commit or print secrets; tests never call the live start.gg API; respect start.gg's Terms (minimum data, no bulk export, attribution, one token); stay on free tiers. If something would cost money or breaks a rule, stop and ask me.
7. **If you hit something `docs/blueprint.md` marked ⚠ unverified** (e.g., start.gg field names for player location, DQ encoding, set "updated-after" filters), verify it by schema introspection or one manual query and record what you found in `docs/startgg-notes.md`.
8. **At the end of the session, and in every PR**, update `STATUS.md` (repo root) with: **Date**, **What changed** (include PR links), **What's next**, **Questions for Clay**, and **Questions for Genghis**.

Start by confirming you've read `CLAUDE.md`, `STATUS.md`, `docs/blueprint.md`, and `.claude/agents/`, then give me a 5-bullet summary of the plan and the first PR you'll open.
