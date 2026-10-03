/**
 * Glicko-2, following Glickman's "Example of the Glicko-2 system"
 * (glicko.net/glicko/glicko2.pdf). Pure: plain data in, plain data out.
 * No I/O, no clock, and a canonical processing order so the same input
 * always gives bit-for-bit the same output.
 */

export type PlayerId = string;

export interface PlayerRating {
  rating: number;
  ratingDeviation: number;
  volatility: number;
}

/** One completed set in the period. `isDq` sets are ignored. */
export interface RatedSet {
  winnerId: PlayerId;
  loserId: PlayerId;
  isDq?: boolean;
}

export interface Glicko2Config {
  /** System constant τ: how fast volatility may change (paper: 0.3 to 1.2). */
  tau: number;
  defaultRating: number;
  defaultRatingDeviation: number;
  defaultVolatility: number;
  /** Convergence tolerance for the Illinois volatility iteration. */
  epsilon: number;
  /** Converts between the Glicko scale and the Glicko-2 scale. */
  scale: number;
}

export const DEFAULT_GLICKO2_CONFIG: Readonly<Glicko2Config> = Object.freeze({
  tau: 0.5,
  defaultRating: 1500,
  defaultRatingDeviation: 350,
  defaultVolatility: 0.06,
  epsilon: 0.000001,
  scale: 173.7178,
});

/** A single result from one player's point of view (score 1 = win, 0 = loss). */
export interface GameResult {
  opponent: PlayerRating;
  score: 0 | 1;
}

export function defaultRating(config: Glicko2Config = DEFAULT_GLICKO2_CONFIG): PlayerRating {
  return {
    rating: config.defaultRating,
    ratingDeviation: config.defaultRatingDeviation,
    volatility: config.defaultVolatility,
  };
}

const g = (phi: number): number => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expectedScore = (mu: number, muJ: number, phiJ: number): number =>
  1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/** Step 5: new volatility via the Illinois algorithm. */
function newVolatility(
  phi: number,
  sigma: number,
  delta: number,
  v: number,
  config: Glicko2Config,
): number {
  const { tau, epsilon } = config;
  const a = Math.log(sigma * sigma);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const denom = phi * phi + v + ex;
    return (
      (ex * (delta * delta - phi * phi - v - ex)) / (2 * denom * denom) - (x - a) / (tau * tau)
    );
  };
  let lower = a;
  let upper: number;
  if (delta * delta > phi * phi + v) {
    upper = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k += 1;
    upper = a - k * tau;
  }
  let fLower = f(lower);
  let fUpper = f(upper);
  while (Math.abs(upper - lower) > epsilon) {
    const c = lower + ((lower - upper) * fLower) / (fUpper - fLower);
    const fC = f(c);
    if (fC * fUpper <= 0) {
      lower = upper;
      fLower = fUpper;
    } else {
      fLower = fLower / 2;
    }
    upper = c;
    fUpper = fC;
  }
  return Math.exp(lower / 2);
}

function assertValidRating(rating: PlayerRating): void {
  const { rating: r, ratingDeviation, volatility } = rating;
  if (
    !Number.isFinite(r) ||
    !(ratingDeviation > 0) ||
    !(volatility > 0) ||
    !Number.isFinite(ratingDeviation) ||
    !Number.isFinite(volatility)
  ) {
    throw new RangeError(
      "Invalid rating: rating must be finite; RD and volatility must be finite and > 0",
    );
  }
}

function assertValidConfig(config: Glicko2Config): void {
  if (!(config.tau > 0) || !(config.epsilon > 0) || !(config.scale > 0)) {
    throw new RangeError("Invalid Glicko-2 config: tau, epsilon and scale must be > 0");
  }
}

/**
 * Update one player for one rating period. All opponents' ratings must be
 * their pre-period values. With no results, only RD inflation (step 6) applies.
 */
export function updatePlayer(
  player: PlayerRating,
  results: readonly GameResult[],
  config: Glicko2Config = DEFAULT_GLICKO2_CONFIG,
): PlayerRating {
  assertValidConfig(config);
  assertValidRating(player);
  for (const { opponent } of results) assertValidRating(opponent);
  const { scale } = config;
  const mu = (player.rating - 1500) / scale;
  const phi = player.ratingDeviation / scale;
  const sigma = player.volatility;

  if (results.length === 0) {
    return { ...player, ratingDeviation: Math.sqrt(phi * phi + sigma * sigma) * scale };
  }

  let vInverse = 0;
  let scoreSum = 0;
  for (const { opponent, score } of results) {
    const muJ = (opponent.rating - 1500) / scale;
    const phiJ = opponent.ratingDeviation / scale;
    const gJ = g(phiJ);
    const e = expectedScore(mu, muJ, phiJ);
    vInverse += gJ * gJ * e * (1 - e);
    scoreSum += gJ * (score - e);
  }
  const v = 1 / vInverse;
  const delta = v * scoreSum;

  const sigmaPrime = newVolatility(phi, sigma, delta, v, config);
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * scoreSum;

  return {
    rating: muPrime * scale + 1500,
    ratingDeviation: phiPrime * scale,
    volatility: sigmaPrime,
  };
}

const compareIds = (a: PlayerId, b: PlayerId): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Rate one period (one ISO week). Returns a new rating for every player in
 * `ratings` plus every newcomer in `sets` (newcomers start at the defaults).
 * DQ sets and self-sets (winner === loser) are ignored. Output is keyed in
 * ascending player-id order; input order of `ratings` and `sets` never matters.
 */
export function ratePeriod(
  ratings: ReadonlyMap<PlayerId, PlayerRating>,
  sets: readonly RatedSet[],
  config: Glicko2Config = DEFAULT_GLICKO2_CONFIG,
): Map<PlayerId, PlayerRating> {
  const counted = sets
    .filter((set) => set.isDq !== true && set.winnerId !== set.loserId)
    .map(({ winnerId, loserId }) => ({ winnerId, loserId }))
    .sort((x, y) => compareIds(x.winnerId, y.winnerId) || compareIds(x.loserId, y.loserId));

  const before = (id: PlayerId): PlayerRating => ratings.get(id) ?? defaultRating(config);
  const resultsByPlayer = new Map<PlayerId, GameResult[]>();
  const addResult = (id: PlayerId, result: GameResult): void => {
    const list = resultsByPlayer.get(id);
    if (list) list.push(result);
    else resultsByPlayer.set(id, [result]);
  };
  for (const { winnerId, loserId } of counted) {
    addResult(winnerId, { opponent: before(loserId), score: 1 });
    addResult(loserId, { opponent: before(winnerId), score: 0 });
  }

  const allIds = [...new Set([...ratings.keys(), ...resultsByPlayer.keys()])].sort(compareIds);
  const next = new Map<PlayerId, PlayerRating>();
  for (const id of allIds) {
    next.set(id, updatePlayer(before(id), resultsByPlayer.get(id) ?? [], config));
  }
  return next;
}
