# Texas city rankings (`texas.json`)

The **Texas tab** of the site lists every Texas city that has a published local power ranking. The list comes entirely from `texas.json` in this folder. These are the local organizers' rankings, not ours: someone copies them in by hand, exactly as posted.

To add or change a city: send Clay or Genghis the list (city, ranking name, season, link to the original post, and the players in order). Genghis or Claude then edits `texas.json` in a pull request. The site updates when the pull request merges.

## The file

```json
{
  "version": 1,
  "updated": "2026-10-03",
  "scenes": [
    {
      "id": "dallas-fort-worth",
      "city": "Dallas-Fort Worth",
      "rankingName": "DFW Ultimate PR 2026 Q2",
      "season": "2026 Q2",
      "sourceUrl": "https://liquipedia.net/smash/Texas_Power_Rankings/Dallas-Fort_Worth",
      "type": "official",
      "players": [
        { "rank": 1, "name": "Atomic" },
        { "rank": 2, "name": "DJDon" },
        { "rank": "HM", "name": "Grapezard X" }
      ]
    }
  ]
}
```

## Fields

- `version`: always `1`.
- `updated`: the date the file was last edited, as `YYYY-MM-DD`. Change it whenever you edit the file.
- `scenes`: one entry per city. The site sorts them alphabetically, so file order does not matter.
  - `id`: a short lowercase name with dashes (`fort-worth`). Must be unique. Do not change it once published, because saved pins use it.
  - `city`: the name shown on the site.
  - `rankingName`: what the organizers call the ranking.
  - `season`: the period it covers, such as `2026 Q2`.
  - `sourceUrl`: link to the original post. Must start with `https://`. Use `null` if there is no link.
  - `type`: `"official"` for a panel-voted power ranking, or `"calculated"` for a formula-based one (for example a Braacket ranking). Calculated cities get a "Calculated ranking" label on the site.
  - `updated` (optional): the date this city's list was published or copied, as `YYYY-MM-DD`. Leave it out if you do not know it. Never guess.
  - `players`: the list, best first. Each has a `rank` and a `name`.

## Names and ranks

- Type names **exactly as published**, including sponsor tags (`PSG | Rubric`) and alternate tags (`Ekoh / Khmaster69`). The site does not trim, split or reformat them.
- `rank` is a number, or the text `"HM"` for an honorable mention (put quotes around HM).
- Numbered ranks count up from 1 with no gaps and no repeats: 1, 2, 3, ...
- HM entries come after all the numbered ranks. There can be several, and they show in the order they appear in the file.

## Rules (a mistake fails the automatic check, so it cannot go live)

- Every player needs a name. Cities can have any number of players.
- Every `id` must be different.
- Links must be `https://`.
- Dates must look like `2026-09-20`.
- `type` must be `"official"` or `"calculated"`.
