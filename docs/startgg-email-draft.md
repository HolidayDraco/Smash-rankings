# Draft: note to start.gg about the app

**For Clay to send** (from your own email, to devrelations@start.gg) before sharing the site publicly. Claude has not sent anything. Edit freely; the bracketed parts need your details.

---

**Subject:** Fan-made Smash Ultimate rankings for Texas, built on the start.gg API

Hi start.gg team,

I'm [your name], and I'm building a small, unofficial fan app that shows Super Smash Bros. Ultimate player rankings for Texas, computed from results on start.gg. It's a hobby project, free to use, with no ads.

Before we share it publicly, I wanted to let you know how it uses the API and make sure that works for you:

- **One API token**, used only by our scheduled data jobs. The website itself never calls start.gg.
- **Polite request rate:** our client stays at or under 60 requests a minute, backs off when asked, and uses a small daily budget for finding new tournaments.
- **Minimum data:** we only read what we display or need to rate players: tournaments and events (name, dates, state and country, entrant count, online or not), sets (who played, who won, score, round, when), final placements, and each player's start.gg id, tag, sponsor prefix and profile link. No emails, no personal details.
- **No re-distribution:** there's no export or bulk download. People see rankings and player pages, nothing more.
- **Attribution:** every page shows "Data from start.gg" with a link back to start.gg, and player pages link to the player's start.gg profile when they have one.
- **Scope:** we look through Ultimate tournament listings by date and keep only events held in Texas. Only in-person singles events with 16 or more entrants count toward the rankings.

If you'd like anything done differently, for example a lower request rate, different wording or placement for the attribution, or something we shouldn't show, just let me know and we'll change it.

Website: [link once it's live]
Code (public): https://github.com/HolidayDraco/Smash-rankings

Thanks for building such a useful platform for the community.

[your name]
[how to reach you]
