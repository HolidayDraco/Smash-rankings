import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createStartggClient, StartggAuthError, StartggSchemaError, type LogEntry } from "./client";
import { TokenBucket } from "./limiter";
import { isSinglesEvent, normalizeSet } from "./normalize";
import type { SetNode } from "./schemas";

const TOKEN = "SECRET-TOKEN-abc123";
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));

type Reply = { status?: number; body: unknown };
function harness(replies: Reply[]) {
  let now = 1_000_000;
  const sent: { variables: Record<string, unknown> }[] = [];
  const sleeps: number[] = [];
  const logs: LogEntry[] = [];
  const queue = [...replies];
  const client = createStartggClient({
    token: TOKEN,
    clock: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    random: () => 1,
    logger: (entry) => logs.push(entry),
    fetch: async (_url, init) => {
      sent.push(JSON.parse(String(init.body)) as { variables: Record<string, unknown> });
      const reply = queue.shift();
      if (!reply) throw new Error("fake fetch: no reply queued");
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
    },
  });
  return { client, sent, sleeps, logs };
}

async function collect<T>(pages: AsyncGenerator<{ items: T[] }>) {
  const all: T[] = [];
  for await (const page of pages) all.push(...page.items);
  return all;
}

describe("pagination", () => {
  it("walks every page and normalizes sets", async () => {
    const { client, sent } = harness([
      { body: fixture("sets-page-1") },
      { body: fixture("sets-page-2") },
    ]);
    const sets = await collect(client.eventSetsPages(9001));
    expect(sent.map((s) => s.variables["page"])).toEqual([1, 2]);
    expect(sets.map((s) => s.id)).toEqual([7001, 7002, 7003]);
    expect(sets[0]).toMatchObject({
      winnerPlayerId: 1,
      loserPlayerId: 2,
      winnerGames: 3,
      loserGames: 1,
      isDq: false,
    });
    expect(client.requestsUsed).toBe(2);
  });

  it("lists tournaments and tells singles from doubles", async () => {
    const { client } = harness([
      { body: fixture("tournaments-page-1") },
      { body: fixture("tournaments-page-2") },
    ]);
    const tournaments = await collect(client.tournamentsPages({ afterDate: 1, beforeDate: 2 }));
    expect(tournaments).toHaveLength(3);
    const events = tournaments.flatMap((t) => t.events ?? []).filter((e) => e !== null);
    expect(events.filter(isSinglesEvent).map((e) => e.id)).toEqual([9001, 9003, 9004]);
  });

  it("reads standings", async () => {
    const { client } = harness([{ body: fixture("standings-page-1") }]);
    const standings = await collect(client.eventStandingsPages(9001));
    expect(standings.map((s) => [s.placement, s.playerId])).toEqual([
      [1, 1],
      [2, 4],
    ]);
  });

  it("resumes from a saved cursor", async () => {
    const { client, sent } = harness([{ body: fixture("sets-page-2") }]);
    const sets = await collect(client.eventSetsPages(9001, { cursor: { page: 2, perPage: 2 } }));
    expect(sent.map((s) => [s.variables["page"], s.variables["perPage"]])).toEqual([[2, 2]]);
    expect(sets.map((s) => s.id)).toEqual([7003]);
  });
});

describe("DQ sets", () => {
  it("flags the DQ and stores null games", async () => {
    const { client } = harness([
      { body: fixture("sets-page-1") },
      { body: fixture("sets-page-2") },
    ]);
    const sets = await collect(client.eventSetsPages(9001));
    expect(sets.find((s) => s.id === 7002)).toMatchObject({
      isDq: true,
      winnerGames: null,
      loserGames: null,
    });
    expect(sets.filter((s) => s.isDq)).toHaveLength(1);
  });
});

function rawSet(
  overrides: Partial<SetNode> & { scores?: [number | null, number | null]; ids?: [number, number] },
): SetNode {
  const scores = overrides.scores ?? [2, 0];
  const ids = overrides.ids ?? [1, 2];
  const slot = (entrantId: number, playerId: number, score: number | null) => ({
    entrant: {
      id: entrantId,
      participants: [
        {
          player: {
            id: playerId,
            gamerTag: `Fake${playerId}`,
            prefix: null,
            user: { slug: `user/fake${playerId}` },
          },
        },
      ],
    },
    standing: { stats: { score: { value: score } } },
  });
  return {
    id: 1,
    completedAt: 1_760_000_000,
    winnerId: 11,
    displayScore: "x",
    fullRoundText: "Round 1",
    slots: [slot(11, ids[0], scores[0]), slot(12, ids[1], scores[1])],
    ...overrides,
  };
}

describe("normalizeSet", () => {
  it("gives null games when a finished set has no scores", () => {
    expect(normalizeSet(rawSet({ scores: [null, null] }), 9)).toMatchObject({
      isDq: false,
      winnerGames: null,
      loserGames: null,
    });
  });

  it("drops sets where the winner and loser are the same player", () => {
    expect(normalizeSet(rawSet({ ids: [5, 5] }), 9)).toBeNull();
  });

  it("carries player info for both sides", () => {
    expect(normalizeSet(rawSet({}), 9)).toMatchObject({
      winner: { playerId: 1, gamerTag: "Fake1", prefix: null, userSlug: "user/fake1" },
      loser: { playerId: 2, userSlug: "user/fake2" },
    });
  });
});

describe("retries and shrinking", () => {
  it("backs off on a rate-limit error then succeeds", async () => {
    const { client, sleeps } = harness([
      { status: 429, body: fixture("error-rate-limit") },
      { body: fixture("error-rate-limit") },
      { body: fixture("standings-page-1") },
    ]);
    const standings = await collect(client.eventStandingsPages(9001));
    expect(standings).toHaveLength(2);
    expect(client.requestsUsed).toBe(3);
    // The first two sleeps are backoff (10 s then 20 s, jitter fixed at max); the limiter adds the rest.
    expect(sleeps).toContain(10_000);
    expect(sleeps).toContain(20_000);
  });

  it("retries 5xx and gives up after maxAttempts", async () => {
    const { client } = harness(Array.from({ length: 6 }, () => ({ status: 502, body: {} })));
    await expect(collect(client.eventStandingsPages(9001))).rejects.toThrow(/HTTP 502/);
    expect(client.requestsUsed).toBe(6);
  });

  it("halves the page size after a complexity error and re-fetches the same items", async () => {
    const { client, sent } = harness([
      { body: fixture("sets-page-1") },
      { body: fixture("error-complexity") },
      { body: fixture("sets-page-2") },
    ]);
    // Page 1 at perPage 40 succeeded (fixture says 2 pages); page 2 is too complex, so perPage 20.
    const pages: number[][] = [];
    for await (const page of client.eventSetsPages(9001)) pages.push([page.page, page.perPage]);
    expect(sent.map((s) => [s.variables["page"], s.variables["perPage"]])).toEqual([
      [1, 40],
      [2, 40],
      [3, 20],
    ]);
    expect(pages).toEqual([
      [1, 40],
      [3, 20],
    ]);
  });

  it("does not retry auth failures", async () => {
    const { client } = harness([
      { status: 401, body: { message: "Invalid authentication token" } },
    ]);
    await expect(collect(client.eventSetsPages(1))).rejects.toBeInstanceOf(StartggAuthError);
    expect(client.requestsUsed).toBe(1);
  });
});

describe("limiter", () => {
  it("never allows more than 60 requests in any 60 s window", async () => {
    let now = 0;
    const bucket = new TokenBucket({
      ratePerMinute: 60,
      clock: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    const stamps: number[] = [];
    for (let i = 0; i < 300; i++) {
      await bucket.acquire();
      stamps.push(now);
    }
    for (const start of stamps) {
      expect(stamps.filter((t) => t >= start && t < start + 60_000).length).toBeLessThanOrEqual(60);
    }
    expect(now).toBeGreaterThanOrEqual(299_000);
  });
});

describe("limiter concurrency", () => {
  it("spaces simultaneous acquire() calls at least 1 s apart", async () => {
    vi.useFakeTimers();
    try {
      const bucket = new TokenBucket({
        ratePerMinute: 60,
        clock: Date.now,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      });
      const stamps: number[] = [];
      const all = Promise.all(
        Array.from({ length: 5 }, () => bucket.acquire().then(() => stamps.push(Date.now()))),
      );
      await vi.advanceTimersByTimeAsync(10_000);
      await all;
      expect(stamps).toHaveLength(5);
      for (let i = 1; i < stamps.length; i++) {
        expect(stamps[i]! - stamps[i - 1]!).toBeGreaterThanOrEqual(1_000);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("safety", () => {
  it("rejects an empty token immediately", () => {
    expect(() => createStartggClient({ token: "" })).toThrow(StartggAuthError);
  });

  it("treats HTTP 200 with errors and no data as a failure", async () => {
    const { client } = harness([{ body: { errors: [{ message: "Something odd" }] } }]);
    await expect(client.rawQuery("Raw", "{ x }")).rejects.toThrow(/Something odd/);
  });

  it("never logs the token, even on failures", async () => {
    const { client, logs } = harness([
      { status: 500, body: { message: `boom ${TOKEN}` } },
      { body: fixture("standings-page-1") },
    ]);
    await collect(client.eventStandingsPages(9001));
    const bad = harness([{ status: 401, body: { message: `bad ${TOKEN}` } }]);
    await collect(bad.client.eventStandingsPages(9001)).catch(() => undefined);
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify([...logs, ...bad.logs])).not.toContain(TOKEN);
  });

  it("rejects a malformed response", async () => {
    const { client } = harness([
      { body: { data: { event: { id: 1, sets: { pageInfo: null, nodes: [{ id: "nope" }] } } } } },
    ]);
    await expect(collect(client.eventSetsPages(1))).rejects.toBeInstanceOf(StartggSchemaError);
  });
});
