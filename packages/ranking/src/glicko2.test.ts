import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_GLICKO2_CONFIG, ratePeriod, updatePlayer } from "./glicko2";
import type { PlayerRating, RatedSet } from "./glicko2";

const player = (rating: number, ratingDeviation: number, volatility = 0.06): PlayerRating => ({
  rating,
  ratingDeviation,
  volatility,
});

describe("Glickman's worked example (mandatory)", () => {
  // Glickman, "Example of the Glicko-2 system": a 1500/200/0.06 player beats a
  // 1400/30, loses to a 1550/100 and a 1700/300, with τ = 0.5.
  //
  // The paper prints r′ = 1464.06, RD′ = 151.52, σ′ = 0.05999, but it rounds its
  // intermediate values to 4 decimals (e.g. μ′ = −0.2069 → 1464.0578). Carrying
  // full precision gives r′ = 1464.0507, RD′ = 151.5165, σ′ = 0.0599960 (checked
  // against an independent Python implementation of the paper's steps). So we
  // assert the exact values tightly, and agreement with the paper's printed
  // figures to within the precision the paper actually carries.
  const EXACT = { rating: 1464.0507, ratingDeviation: 151.5165, volatility: 0.059996 };

  const expectMatchesPaper = (result: PlayerRating | undefined) => {
    expect(result).toBeDefined();
    if (!result) return;
    // Exact (full-precision) values.
    expect(result.rating).toBeCloseTo(EXACT.rating, 3);
    expect(result.ratingDeviation).toBeCloseTo(EXACT.ratingDeviation, 3);
    expect(result.volatility).toBeCloseTo(EXACT.volatility, 6);
    // The paper's printed figures, within its intermediate rounding.
    expect(Math.abs(result.rating - 1464.06)).toBeLessThan(0.01);
    expect(Math.abs(result.ratingDeviation - 151.52)).toBeLessThan(0.01);
    expect(Math.abs(result.volatility - 0.05999)).toBeLessThan(0.00001);
  };

  it("reproduces r′ 1464.06, RD′ 151.52, σ′ 0.05999 with τ = 0.5", () => {
    const next = updatePlayer(
      player(1500, 200),
      [
        { opponent: player(1400, 30), score: 1 },
        { opponent: player(1550, 100), score: 0 },
        { opponent: player(1700, 300), score: 0 },
      ],
      { ...DEFAULT_GLICKO2_CONFIG, tau: 0.5 },
    );
    expectMatchesPaper(next);
  });

  it("gives the same answer through ratePeriod", () => {
    const ratings = new Map([
      ["a", player(1500, 200)],
      ["b", player(1400, 30)],
      ["c", player(1550, 100)],
      ["d", player(1700, 300)],
    ]);
    const sets: RatedSet[] = [
      { winnerId: "a", loserId: "b" },
      { winnerId: "c", loserId: "a" },
      { winnerId: "d", loserId: "a" },
    ];
    expectMatchesPaper(ratePeriod(ratings, sets).get("a"));
  });
});

describe("ratePeriod", () => {
  it("starts newcomers at 1500 / 350 / 0.06", () => {
    const next = ratePeriod(new Map(), [{ winnerId: "x", loserId: "y" }]);
    expect([...next.keys()]).toEqual(["x", "y"]);
    expect(next.get("x")?.rating).toBeGreaterThan(1500);
    expect(next.get("y")?.rating).toBeLessThan(1500);
  });

  it("only inflates RD for players with no sets", () => {
    const idle = player(1800, 60);
    const next = ratePeriod(new Map([["idle", idle]]), []).get("idle");
    expect(next?.rating).toBe(1800);
    expect(next?.volatility).toBe(0.06);
    expect(next?.ratingDeviation).toBeCloseTo(
      Math.sqrt((60 / 173.7178) ** 2 + 0.06 ** 2) * 173.7178,
      10,
    );
  });

  it("ignores DQ sets and self-sets", () => {
    const ratings = new Map([
      ["a", player(1500, 100)],
      ["b", player(1500, 100)],
    ]);
    const withDq = ratePeriod(ratings, [
      { winnerId: "a", loserId: "b", isDq: true },
      { winnerId: "a", loserId: "a" },
    ]);
    expect(withDq).toEqual(ratePeriod(ratings, []));
  });
});

const ids = ["p1", "p2", "p3", "p4", "p5"];
const arbRating = fc.record({
  rating: fc.double({ min: 800, max: 2600, noNaN: true }),
  ratingDeviation: fc.double({ min: 30, max: 350, noNaN: true }),
  volatility: fc.double({ min: 0.03, max: 0.1, noNaN: true }),
});
const arbSets = fc.array(
  fc
    .tuple(fc.constantFrom(...ids), fc.constantFrom(...ids), fc.boolean())
    .map(([winnerId, loserId, isDq]): RatedSet => ({ winnerId, loserId, isDq })),
  { maxLength: 30 },
);

describe("properties", () => {
  it("a win never lowers a rating", () => {
    fc.assert(
      fc.property(arbRating, arbRating, (me, opponent) => {
        expect(updatePlayer(me, [{ opponent, score: 1 }]).rating).toBeGreaterThanOrEqual(me.rating);
      }),
    );
  });

  // Not universal: a player whose RD is already very low can gain a little RD from
  // one lopsided set, because the weekly inflation outweighs that set's information
  // (e.g. RD 30 → 30.33). So this checks uncertain players vs. established opponents.
  it("RD shrinks after play (uncertain player, established opponents)", () => {
    const arbCase = fc
      .record({
        rating: fc.double({ min: 1000, max: 2200, noNaN: true }),
        ratingDeviation: fc.double({ min: 150, max: 350, noNaN: true }),
        volatility: fc.double({ min: 0.03, max: 0.1, noNaN: true }),
      })
      .chain((me) =>
        fc.tuple(
          fc.constant(me),
          fc.array(
            fc.record({
              opponent: fc.record({
                rating: fc.double({ min: me.rating - 300, max: me.rating + 300, noNaN: true }),
                ratingDeviation: fc.double({ min: 30, max: 100, noNaN: true }),
                volatility: fc.constant(0.06),
              }),
              score: fc.constantFrom<0 | 1>(0, 1),
            }),
            { minLength: 1, maxLength: 15 },
          ),
        ),
      );
    fc.assert(
      fc.property(arbCase, ([me, results]) => {
        expect(updatePlayer(me, results).ratingDeviation).toBeLessThan(me.ratingDeviation);
      }),
    );
  });
  it("RD grows when inactive", () => {
    fc.assert(
      fc.property(arbRating, (me) => {
        expect(updatePlayer(me, []).ratingDeviation).toBeGreaterThan(me.ratingDeviation);
      }),
    );
  });

  it("is deterministic regardless of input order", () => {
    fc.assert(
      fc.property(
        fc.array(arbRating, { minLength: ids.length, maxLength: ids.length }),
        arbSets,
        fc.integer(),
        (startRatings, sets, seed) => {
          const entries = ids.map((id, i): [string, PlayerRating] => [id, startRatings[i]!]);
          const shuffle = <T>(list: readonly T[]): T[] =>
            list
              .map((value, i) => ({ value, key: Math.sin(seed + i * 7919) }))
              .sort((x, y) => x.key - y.key)
              .map(({ value }) => value);
          const a = ratePeriod(new Map(entries), sets);
          const b = ratePeriod(new Map(shuffle(entries)), shuffle(sets));
          expect([...b.entries()]).toEqual([...a.entries()]);
        },
      ),
    );
  });
});

describe("input guards", () => {
  it("rejects non-finite ratings and non-positive RD", () => {
    expect(() => updatePlayer(player(Number.NaN, 200), [])).toThrow(RangeError);
    expect(() => updatePlayer(player(1500, 0), [])).toThrow(RangeError);
    expect(() =>
      updatePlayer(player(1500, 200), [{ opponent: player(1500, Infinity), score: 1 }]),
    ).toThrow(RangeError);
  });

  it("rejects a non-positive tau", () => {
    expect(() =>
      updatePlayer(player(1500, 200), [], { ...DEFAULT_GLICKO2_CONFIG, tau: 0 }),
    ).toThrow(RangeError);
  });
});
