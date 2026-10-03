# Phase 2 plan: two tabs, Texas rankings, Dashboard

**Status:** Planned, October 3, 2026 (from GitHub issue #24)
**Goal (plain English):** The public site shows only two tabs: **Dashboard** and **Texas**. The style guide, status and methodology pages stay online at their web addresses but are not in the menu. Methodology gets one small "How rankings work" link in the footer.

On phones the two tabs sit in a bar at the bottom of the screen. On desktop they sit at the top, in the header.

## The five PRs

1. **Two-tab shell (this PR).** The tab bar, a placeholder Texas page, the Dashboard tab showing today's leaderboard, and a trimmed footer.
2. **Texas tab.** A file `data/scenes/texas.json` with 3 or 4 clearly fake sample scenes (cities), a loader that checks the file's shape with Zod, search, pin a scene (saved in the browser's local storage), and expand a scene to see more.
3. **Tournament city.** One new, additive database column for the tournament's city, and the daily discover job reads `Tournament.city` from start.gg. Existing data is untouched.
4. **API `/v1/dashboard`.** One cached endpoint returning the Texas top 10, biggest movers, upsets, this week's events, and the year at a glance.
5. **Dashboard UI.** The Dashboard tab shows those sections, with loading skeletons, empty and error states.

## Stated defaults (change them by telling us)

- **Main-character icon:** we don't have per-player character data (we rate sets, not games), so no icon or text is shown until that data exists.
- **Upset size:** measured by the rating gap between the two players at the start of that week.
- **Week:** Monday to Sunday, UTC, matching our rating weeks.

## Rules that carry through all five PRs

- White background, light theme only, Barlow Condensed italic and Barlow, no Nintendo assets.
- "Data from start.gg" and the "Last updated" badge on every screen with start.gg data.
- Every new page gets a Playwright test and an axe check with no serious or critical issues.
