import { describe, expect, it } from "vitest";
import { ratePeriod } from "./glicko2";
import { rateHistory, ratingsAt, resolveAlias } from "./history";
import type { PeriodSet } from "./history";
import { buildLeaderboard, eligibilityStats } from "./leaderboard";

const set = (winnerId: string, loserId: string, period: number, extra = {}): PeriodSet => ({
  winnerId,
  loserId,
  period,
  eventId: `e${period}`,
  ...extra,
});

/** Small deterministic PRNG (mulberry32) for synthetic data. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function syntheticSets(players: number, sets: number, weeks: number, seed = 42): PeriodSet[] {
  const next = random(seed);
  const result: PeriodSet[] = [];
  for (let i = 0; i < sets; i += 1) {
    const a = Math.floor(next() * players);
    const b = (a + 1 + Math.floor(next() * (players - 1))) % players;
    const period = Math.floor(next() * weeks);
    const event = `e${period}-${Math.floor(next() * 4)}`;
    // Lower ids win more often, so ratings spread out.
    const aWins = next() < (a < b ? 0.7 : 0.3);
    result.push({
      winnerId: `p${aWins ? a : b}`,
      loserId: `p${aWins ? b : a}`,
      period,
      eventId: event,
      isDq: next() < 0.01,
    });
  }
  return result;
}

describe("rateHistory", () => {
  it("matches ratePeriod week by week and starts players at their first set", () => {
    const sets = [set("a", "b", 10), set("c", "a", 11), set("b", "c", 12)];
    const { ratings, history } = rateHistory({ sets, fromPeriod: 10, toPeriod: 12 });

    let expected = ratePeriod(new Map(), [sets[0]!]);
    expected = ratePeriod(expected, [sets[1]!]);
    expected = ratePeriod(expected, [sets[2]!]);
    expect(ratings).toEqual(expected);

    // a, b from week 10; c joins in week 11.
    expect(history.map((row) => `${row.period}:${row.playerId}:${row.setsPlayed}`)).toEqual([
      "10:a:1",
      "10:b:1",
      "11:a:1",
      "11:b:0",
      "11:c:1",
      "12:a:0",
      "12:b:1",
      "12:c:1",
    ]);
    expect(ratingsAt(history, 12)).toEqual(ratings);
  });

  it("inflates RD across several inactive weeks", () => {
    const { history } = rateHistory({
      sets: [set("a", "b", 0), set("a", "b", 0), set("b", "a", 0)],
      fromPeriod: 0,
      toPeriod: 5,
    });
    const rdOfA = history.filter((row) => row.playerId === "a").map((row) => row.ratingDeviation);
    expect(rdOfA).toHaveLength(6);
    for (let i = 1; i < rdOfA.length; i += 1) expect(rdOfA[i]!).toBeGreaterThan(rdOfA[i - 1]!);
    const ratingOfA = history.filter((row) => row.playerId === "a").map((row) => row.rating);
    expect(new Set(ratingOfA).size).toBe(1);
  });

  it("drops DQs, out-of-range sets, and self-sets after alias merges", () => {
    const aliases = new Map([["a2", "a"]]);
    const { ratings, history } = rateHistory({
      sets: [
        set("a", "b", 1, { isDq: true }),
        set("a2", "a", 1),
        set("c", "d", 0),
        set("c", "d", 3),
      ],
      fromPeriod: 1,
      toPeriod: 2,
      aliases,
    });
    expect(ratings.size).toBe(0);
    expect(history).toEqual([]);
  });

  it("merges an alias's history into the main player", () => {
    const aliases = new Map([
      ["old", "main"],
      ["older", "old"],
    ]);
    expect(resolveAlias("older", aliases)).toBe("main");
    const merged = rateHistory({
      sets: [set("old", "x", 0), set("older", "y", 1), set("main", "x", 2)],
      fromPeriod: 0,
      toPeriod: 2,
      aliases,
    });
    const direct = rateHistory({
      sets: [set("main", "x", 0), set("main", "y", 1), set("main", "x", 2)],
      fromPeriod: 0,
      toPeriod: 2,
    });
    expect(merged).toEqual(direct);
    expect(merged.history.some((row) => row.playerId === "old")).toBe(false);
    expect(() =>
      resolveAlias(
        "p",
        new Map([
          ["p", "q"],
          ["q", "p"],
        ]),
      ),
    ).toThrow(/cycle/);
  });

  it("rejects bad period ranges", () => {
    expect(() => rateHistory({ sets: [], fromPeriod: 3, toPeriod: 2 })).toThrow(RangeError);
    expect(() => rateHistory({ sets: [], fromPeriod: 0.5, toPeriod: 2 })).toThrow(RangeError);
  });

  it("gives identical output for any input order", () => {
    const sets = syntheticSets(50, 400, 8, 7);
    const shuffled = [...sets].reverse();
    const next = random(99);
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    const run = (input: PeriodSet[]) => {
      const { ratings, history } = rateHistory({ sets: input, fromPeriod: 0, toPeriod: 7 });
      const stats = eligibilityStats({ sets: input, asOfPeriod: 7 });
      const rules = { minRatedSets: 10, minQualifyingEvents: 3, maxRatingDeviation: 200 };
      return { history, board: buildLeaderboard({ ratings, stats, rules }) };
    };
    const a = run(sets);
    const b = run(shuffled);
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.board.some((row) => row.rank === 1)).toBe(true);
  });

  it("rates 2k players and 20k sets over 52 weeks in a few seconds", () => {
    const sets = syntheticSets(2_000, 20_000, 52);
    const started = performance.now();
    const { ratings, history } = rateHistory({ sets, fromPeriod: 0, toPeriod: 51 });
    const stats = eligibilityStats({ sets, asOfPeriod: 51 });
    const board = buildLeaderboard({ ratings, stats });
    const elapsedMs = performance.now() - started;
    console.info(
      `rateHistory synthetic (2k players, 20k sets, 52 weeks): ${elapsedMs.toFixed(0)} ms`,
    );
    expect(ratings.size).toBe(2_000);
    expect(board).toHaveLength(2_000);
    expect(history.length).toBeGreaterThan(2_000 * 40);
    expect(elapsedMs).toBeLessThan(5_000);
  });
});
