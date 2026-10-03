# How the rankings work

_Draft. This page explains the numbers in plain English. The technical decision record is `docs/adr/0002-ranking-method.md`._

## What counts

- **Sets, not games.** A set win counts as a win and a set loss counts as a loss. The score inside the set (3-0 or 3-2) doesn't change anything.
- **Only real results.** Disqualifications and forfeits are skipped, because nobody actually played.
- **Only qualifying events.** In-person Super Smash Bros. Ultimate singles events on start.gg, **held in Texas**, with **at least 16 entrants**. Online events and events outside Texas don't count. We may add more states later.
- **One person, one rating.** If someone has more than one start.gg account and we've linked them, all their sets count for one player.
- **The last 12 months.** Ratings are worked out from scratch over the last 52 weeks every time they update. Older results drop off as time moves on.

## How a rating changes

We use **Glicko-2**, a well-known rating system created by statistician Mark Glickman. Every player has three numbers:

- **Rating:** how strong we think you are. Everyone starts at 1500.
- **Rating deviation (RD):** how _unsure_ we are about that rating. New players start at 350 (very unsure). It goes down as you play and slowly goes back up when you don't.
- **Volatility:** how up-and-down your results have been lately.

Beating a strong player raises your rating more than beating a weaker one. Losing to a weaker player costs more than losing to a stronger one.

Results are grouped into **weeks** (Monday 00:00 to Sunday 23:59, UTC time). All sets in the same week are treated as if they happened at the same moment, so the order you played them in that week doesn't matter.

## Why the leaderboard uses a "conservative score"

The leaderboard is sorted by **rating minus two times RD**. That is the low end of the range where your true skill very likely sits (about 95% confidence).

This stops a newcomer who wins a few lucky sets from jumping straight to #1. Your score rises as you prove yourself over more sets, and it slowly drifts down if you stop playing, because RD grows.

## Who appears on the leaderboard

In the last 12 months, a player needs:

- at least **10 rated sets**,
- at least **3 qualifying events** (being on an event's results list counts, even if every set you had there was a DQ),
- and an **RD of 110 or lower** (we are reasonably sure about them).

Everyone is still rated. Players who don't meet these rules just aren't shown on the ranked list yet.

"The last 12 months" means the last 52 weekly rating periods, counting the current week.

## Rank change over 7 days

Next to each rank is how many places the player moved compared with the ranks at the end of last week (the last update before Monday 00:00 UTC). A positive number means they moved up. Players who weren't ranked at the end of last week show as new, with no number. If the rankings didn't update at all last week, everyone shows as new for that week rather than being compared with an older list.

Ranks can change even in a week you didn't play. Other players' results move them, and your RD grows a little every week you sit out, which lowers your conservative score.

## Dashboard numbers

The Dashboard uses the same counting rules as the rankings: qualifying Texas events only, and no disqualifications.

- **This week** is the current rating week, Monday 00:00 to Sunday 23:59 UTC.
- **Biggest movers** are the ranked players whose rank changed the most over 7 days, up to 3 climbers and 3 fallers. New players aren't included.
- **Upsets** are sets this week where the winner's rating at the start of the week was lower than the loser's. The bigger the gap, the bigger the upset. A set is skipped if either player had no rating before this week.
- **This year** counts qualifying events that have started since January 1 (UTC). "Players" counts everyone who played at least one counted set at them, and "most wins" counts 1st-place finishes.

## When the numbers update

The rankings are recalculated after every data refresh (every few hours, hourly on weekends). The current week counts the sets played so far, so it can change until the week ends. Each update replaces the whole list at once, so you never see a half-finished list. "Last active" is the time of the player's most recent counted set.

## Limits

- **Only start.gg data.** Events run elsewhere are missing.
- **No context.** The system only sees who beat whom. It doesn't know about injuries, travel, character changes, or sandbagging.
- **Small regions can drift.** Players who mostly play each other can end up rated high or low compared with other regions until they meet outside players.
- **It is not UltRank.** UltRank is a well-known community ranking that uses a different method. Our list is an unofficial fan project and will sometimes disagree with it.
