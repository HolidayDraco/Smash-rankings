# How the rankings work

_Draft. This page explains the numbers in plain English. The technical decision record is `docs/adr/0002-ranking-method.md`._

## What counts

- **Sets, not games.** A set win counts as a win and a set loss counts as a loss. The score inside the set (3-0 or 3-2) doesn't change anything.
- **Only real results.** Disqualifications and forfeits are skipped, because nobody actually played.
- **Only qualifying events.** In-person Super Smash Bros. Ultimate singles events on start.gg with at least 64 entrants. Online events and small weeklies don't count.

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
- at **3 or more qualifying events**,
- and an **RD of 110 or lower** (we are reasonably sure about them).

Everyone is still rated. Players who don't meet these rules just aren't shown on the ranked list yet.

"The last 12 months" means the last 52 weekly rating periods, counting the current week.

## Rank change over 7 days

Next to each rank is how many places the player moved since the ranking one week earlier. A positive number means they moved up. Players who weren't ranked a week ago show as new, with no number.

Ranks can change even in a week you didn't play. Other players' results move them, and your RD grows a little every week you sit out, which lowers your conservative score.

## Limits

- **Only start.gg data.** Events run elsewhere are missing.
- **No context.** The system only sees who beat whom. It doesn't know about injuries, travel, character changes, or sandbagging.
- **Small regions can drift.** Players who mostly play each other can end up rated high or low compared with other regions until they meet outside players.
- **It is not UltRank.** UltRank is a well-known community ranking that uses a different method. Our list is an unofficial fan project and will sometimes disagree with it.
