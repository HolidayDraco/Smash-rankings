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

**What changed:** Clay changed decision 8. The app uses a white background and a light theme, not a dark one. The feel should be premium and specific: bold condensed italic display type, angled panels, dense stat layouts, strong color accents, and snappy motion, close to Super Smash Bros. Ultimate's UI but built only from original design. Fonts are freely licensed Google Fonts (Barlow Condensed italic for display, Barlow for UI text, Saira Condensed italic as a sportier option). No Nintendo fonts, logos, character art, or other assets. No generic component-library look and no generic gradients. The frontend agent must ship a style-guide page and get Clay's approval before real screens. Updated `docs/blueprint.md` (Decisions locked #8 and Design principles), `.claude/agents/frontend-ui.md`, and the related notes in `CLAUDE.md` and `docs/mission.md`.

**What's next:** Phase 0 (setup) has not started. The next session should read `CLAUDE.md`, `docs/blueprint.md`, and this file, then have the architect write `docs/plans/phase-0.md` and `docs/plans/phase-1.md`. The first UI work includes the style-guide page.

**Questions for Clay:** None.

**Questions for Genghis:** None.
