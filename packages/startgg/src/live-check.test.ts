import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createStartggClient } from "./client";
import { parseLiveCheckArgs, renderReport, runLiveCheck, scrubRecorded } from "./live-check";

const TOKEN = ["fake", "tok", "en123"].join("-");

/** A clock that only moves when the limiter or backoff sleeps, so tests run instantly. */
function fakeTime() {
  let now = 1_000_000;
  return {
    clock: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

type Json = Record<string, unknown>;
interface World {
  addrStateFilter?: boolean;
  addrState?: string;
  countryCode?: string;
  city?: string | null;
  idsAsStrings?: boolean;
  noTexasEvent?: boolean;
  rateLimitFirst?: boolean;
  complexityAbove?: number;
  setPages?: number;
  weirdSets?: boolean;
  introspectionBlocked?: boolean;
  missingEvent?: boolean;
}

function fakeClient(world: World = {}) {
  const queries: string[] = [];
  const sent: { query: string; variables?: { page?: number; perPage?: number } }[] = [];
  const id = (n: number) => (world.idsAsStrings ? String(n) : n);
  let limited = world.rateLimitFirst ?? false;
  const tournament = (n: number, state: string) => ({
    id: id(n),
    name: "T",
    slug: "t",
    countryCode: world.countryCode ?? "US",
    addrState: state,
    city: world.city === undefined ? "Austin" : world.city,
    isOnline: false,
    numAttendees: 40,
    startAt: 1,
    endAt: 2,
    events: [
      {
        id: id(n * 10),
        name: "Singles",
        slug: "s",
        numEntrants: world.noTexasEvent ? 8 : 32,
        isOnline: false,
        state: "COMPLETED",
        startAt: 1,
        type: 1,
        teamRosterSize: null,
        videogame: { id: 1386 },
      },
    ],
  });
  const player = (n: number) => ({
    entrant: {
      id: id(n),
      participants: [
        { player: { id: id(n), gamerTag: `Tag${n}`, prefix: null, user: { slug: `user/${n}` } } },
      ],
    },
    standing: { stats: { score: { value: n === 2 ? -1 : 3 } } },
  });
  const respond = (body: {
    query: string;
    variables?: { page?: number; perPage?: number };
  }): { status?: number; json: Json } => {
    queries.push(body.query);
    sent.push(body);
    if (body.query.includes("LiveCheckSchema")) {
      if (world.introspectionBlocked)
        return { json: { errors: [{ message: "Introspection is disabled" }] } };
      const field = (name: string, ofType: string) => ({
        name,
        type: { kind: "SCALAR", name: ofType },
      });
      return {
        json: {
          data: {
            tf: {
              inputFields: [
                field("name", "String"),
                ...(world.addrStateFilter ? [field("addrState", "String")] : []),
              ],
            },
            sf: { inputFields: [field("state", "[Int]"), field("updatedAfter", "Timestamp")] },
            ev: {
              fields: [{ name: "type", description: "Type of event, whether VideoGame, Team etc" }],
            },
          },
        },
      };
    }
    if (body.query.includes("LiveCheckState")) {
      return {
        json: {
          data: {
            tournaments: { pageInfo: { total: 120, totalPages: 6 }, nodes: [tournament(5, "TX")] },
          },
        },
      };
    }
    if (body.query.includes("TournamentsPage")) {
      if (world.complexityAbove && (body.variables?.perPage ?? 0) > world.complexityAbove) {
        return { json: { errors: [{ message: "Query complexity too high" }] } };
      }
      if (limited) {
        limited = false;
        return { status: 200, json: { errors: [{ message: "Rate limit exceeded - api-token" }] } };
      }
      return {
        json: {
          data: {
            tournaments: {
              pageInfo: { total: 700, totalPages: 35 },
              nodes: [tournament(1, "CA"), tournament(2, world.addrState ?? "TX")],
            },
          },
        },
      };
    }
    if (body.query.includes("LiveCheckAllSets")) {
      return { json: { data: { event: { sets: { pageInfo: { total: 33 } } } } } };
    }
    if (body.query.includes("EventSetsPage")) {
      if (world.missingEvent) return { json: { data: { event: null } } };
      if (world.weirdSets)
        return { json: { data: { event: { id: id(1), sets: { pageInfo: null, nodes: null } } } } };
      return {
        json: {
          data: {
            event: {
              id: id(1),
              sets: {
                pageInfo: { total: 31, totalPages: world.setPages ?? 1 },
                nodes: [
                  {
                    id: id(100),
                    completedAt: 5,
                    winnerId: id(1),
                    displayScore: "Tag1 3 - Tag3 0",
                    fullRoundText: "Winners R1",
                    slots: [player(1), player(3)],
                  },
                  {
                    id: id(101),
                    completedAt: 6,
                    winnerId: id(3),
                    displayScore: "DQ",
                    fullRoundText: "Winners R1",
                    slots: [player(2), player(3)],
                  },
                ],
              },
            },
          },
        },
      };
    }
    return {
      json: {
        data: {
          event: {
            id: id(1),
            standings: {
              pageInfo: { total: 32, totalPages: 1 },
              nodes: [
                { placement: 1, entrant: { id: id(1), participants: [{ player: { id: id(1) } }] } },
              ],
            },
          },
        },
      },
    };
  };
  const client = createStartggClient({
    token: TOKEN,
    ...fakeTime(),
    logger: () => undefined,
    random: () => 0,
    fetch: async (_url, init) => {
      const { status = 200, json } = respond(
        JSON.parse(String(init.body)) as {
          query: string;
          variables?: { page?: number; perPage?: number };
        },
      );
      return new Response(JSON.stringify(json), { status });
    },
  });
  return { client, queries, sent };
}

describe("live check report", () => {
  it("still probes the state filter when introspection is blocked", async () => {
    const { client, queries } = fakeClient({ introspectionBlocked: true });
    const result = await runLiveCheck(client);
    expect(result.schema).toBeNull();
    expect(queries.some((q) => q.includes("LiveCheckState"))).toBe(true);
    expect(result.stateFilterProbe).toMatchObject({ total: 120 });
  });

  it("flags completed-only vs unfiltered set totals that differ on a finished event", async () => {
    const report = renderReport(await runLiveCheck(fakeClient().client));
    expect(report).toContain("differs by 2: on a finished event these sets are invisible to sync");
  });

  it("reports an --event id that does not exist, and labels a hand-picked event", async () => {
    const result = await runLiveCheck(fakeClient({ missingEvent: true }).client, { eventId: 999 });
    expect(result.errors.some((e) => e.message.includes("event 999 not found"))).toBe(true);
    expect(renderReport(result)).toContain("Event chosen with --event");
  });

  it("answers the addrState filter question yes, and probes it", async () => {
    const { client, queries } = fakeClient({ addrStateFilter: true });
    const result = await runLiveCheck(client);
    expect(result.schema).toMatchObject({
      hasAddrStateFilter: true,
      hasUpdatedAfter: true,
      hasSetStateFilter: true,
    });
    expect(result.schema?.eventTypeDescription).toContain("Type of event");
    expect(result.stateFilterProbe).toMatchObject({ total: 120, requestsPerRun: 6, accepted: 1 });
    expect(queries.some((q) => q.includes("LiveCheckState"))).toBe(true);
    expect(renderReport(result)).toContain("addrState (filter by state on start.gg's side): YES");
  });

  it("answers no, and sends no Texas probe", async () => {
    const { client, queries } = fakeClient({ addrStateFilter: false });
    const result = await runLiveCheck(client);
    expect(result.schema?.hasAddrStateFilter).toBe(false);
    expect(queries.some((q) => q.includes("LiveCheckState"))).toBe(false);
    expect(renderReport(result)).toContain("addrState (filter by state on start.gg's side): no");
  });

  it("reports a sample of city values, and counts empty ones", async () => {
    const seen = await runLiveCheck(fakeClient({ addrState: "TX" }).client);
    expect(seen.tournaments?.citySamples).toEqual(["Austin"]);
    expect(seen.tournaments?.cityMissing).toBe(0);
    expect(renderReport(seen)).toContain('"Austin"');
    const empty = await runLiveCheck(fakeClient({ addrState: "TX", city: null }).client);
    expect(empty.tournaments?.citySamples).toEqual([]);
    expect(empty.tournaments?.cityMissing).toBe(1);
  });

  it("reports TX vs Texas and warns about values the region rule rejects", async () => {
    const tx = await runLiveCheck(fakeClient({ addrState: "TX" }).client);
    expect(tx.tournaments?.addrStates).toEqual({ CA: 1, TX: 1 });
    expect(tx.tournaments?.acceptedByLaunchRegion).toBe(1);
    const full = await runLiveCheck(fakeClient({ addrState: "Texas" }).client);
    expect(full.tournaments?.addrStates).toEqual({ CA: 1, Texas: 1 });
    expect(full.tournaments?.acceptedByLaunchRegion).toBe(1);
    const odd = await runLiveCheck(fakeClient({ addrState: "TEX." }).client);
    expect(odd.tournaments?.acceptedByLaunchRegion).toBe(0);
    expect(odd.tournaments?.regionLookingRejected).toEqual(["TEX."]);
    expect(renderReport(odd)).toContain("WARNING");
    const usa = await runLiveCheck(fakeClient({ countryCode: "USA" }).client);
    expect(usa.tournaments?.countryCodes).toEqual({ USA: 12 });
    expect(usa.tournaments?.acceptedByLaunchRegion).toBe(0);
  });

  it("detects number vs string ids", async () => {
    const numbers = await runLiveCheck(fakeClient().client);
    expect(numbers.idKinds["tournament id"]).toBe("number");
    expect(numbers.typedSchemaAccepts).toEqual({ tournaments: true, sets: true, standings: true });
    const strings = await runLiveCheck(fakeClient({ idsAsStrings: true }).client);
    expect(strings.idKinds["tournament id"]).toBe("string");
    expect(strings.idKinds["player id"]).toBe("string");
    expect(strings.typedSchemaAccepts.tournaments).toBe(false);
    expect(renderReport(strings)).toContain("tournament id: string");
  });

  it("summarises the sample event: totals, slug visibility, DQ signals, type tally", async () => {
    const result = await runLiveCheck(fakeClient().client);
    expect(result.event?.sets).toMatchObject({
      completedTotal: 31,
      firstPageSets: 2,
      lastPageSets: null,
      userSlugVisible: { visible: 3, players: 3 },
    });
    expect(result.event?.allSetsTotal).toBe(33);
    expect(result.event?.standings).toMatchObject({ total: 32, onPage: 1 });
    expect(result.event?.sets?.objectsPerPage).toBeGreaterThan(10);
    expect(result.event?.sets?.dq).toMatchObject({
      displayScoreDq: 1,
      scoreMinusOne: 1,
      completedAtNull: 0,
      winnerIdNull: 0,
    });
    expect(result.event?.sets?.dq.examples[0]).toMatchObject({ id: 101, displayScore: "DQ" });
    expect(result.eventTypes).toEqual({ "type 1 / max players null": 2 });
    expect(result.tournaments).toMatchObject({ totalInWindow: 700, discoverRequestsPerRun: 35 });
    expect(result.steps.map((s) => s.step)).toEqual([
      "LiveCheckSchema",
      "TournamentsPage",
      "EventSetsPage",
      "LiveCheckAllSets",
      "EventStandingsPage",
    ]);
    expect(result.requestsUsed).toBe(5);
    const text = renderReport(result);
    expect(text).toContain("discover requests per run: 35");
    expect(text).toContain("differs");
  });

  it("uses the discover window: 14 days back to 30 days ahead", async () => {
    const { client, sent } = fakeClient();
    const now = Date.UTC(2026, 9, 3);
    await runLiveCheck(client, { now });
    const vars = sent.find((r) => r.query.includes("TournamentsPage"))?.variables as Record<
      string,
      number
    >;
    expect(vars["afterDate"]).toBe(now / 1000 - 14 * 86_400);
    expect(vars["beforeDate"]).toBe(now / 1000 + 30 * 86_400);
  });

  it("reads the last sets page too, and honours --event", async () => {
    const { client, sent } = fakeClient({ setPages: 3 });
    const result = await runLiveCheck(client, { eventId: 777 });
    const pages = sent
      .filter((r) => r.query.includes("EventSetsPage"))
      .map((r) => r.variables?.page);
    expect(pages).toEqual([1, 3]);
    expect(result.event).toMatchObject({ id: 777 });
    expect(result.event?.sets).toMatchObject({ totalPages: 3, lastPageSets: 2 });
  });

  it("keeps the reduced page size for later tournament pages", async () => {
    const { client, sent } = fakeClient({ complexityAbove: 10, noTexasEvent: true });
    await runLiveCheck(client);
    const sizes = sent
      .filter((r) => r.query.includes("TournamentsPage"))
      .map((r) => r.variables?.perPage);
    expect(sizes.slice(0, 3)).toEqual([20, 10, 10]);
    expect(new Set(sizes.slice(1))).toEqual(new Set([10]));
  });

  it("turns an odd response shape into a finding and keeps the other results", async () => {
    const result = await runLiveCheck(fakeClient({ weirdSets: true }).client);
    expect(result.errors.map((e) => [e.step, e.name])).toEqual([["sets", "ParseError"]]);
    expect(result.event?.sets).toBeNull();
    expect(result.event?.standings).toMatchObject({ total: 32 });
    const text = renderReport(result);
    expect(text).toContain("Sets: failed");
    expect(text).not.toContain("page size 0");
  });

  it("explains when no Texas event is found, within the page cap", async () => {
    const result = await runLiveCheck(fakeClient({ noTexasEvent: true }).client);
    expect(result.event).toBeNull();
    expect(result.noEventReason).toContain("No completed in-person TX");
    expect(result.requestsUsed).toBe(7); // schema + page cap, not the 35 pages that exist
  });

  it("counts retries toward the request total", async () => {
    const result = await runLiveCheck(fakeClient({ rateLimitFirst: true }).client);
    expect(result.requestsUsed).toBe(6); // includes the retry
    expect(result.errors).toEqual([]);
  });
});

describe("request budget", () => {
  it("stops cleanly when the budget is reached", async () => {
    const result = await runLiveCheck(
      fakeClient({ addrStateFilter: true, noTexasEvent: true }).client,
      { budget: 3 },
    );
    expect(result.requestsUsed).toBe(3);
    expect(result.stoppedForBudget).toBe(true);
    expect(result.errors).toEqual([]);
    expect(renderReport(result)).toContain("stopped early");
  });
});

describe("secrets", () => {
  it("never puts the token in the report, errors or recorded data", async () => {
    const { client } = fakeClient();
    const recorded: unknown[] = [];
    const result = await runLiveCheck(client, {
      onRaw: (_n, d) => recorded.push(scrubRecorded(d)),
    });
    const text = renderReport(result) + JSON.stringify(result) + JSON.stringify(recorded);
    expect(text).not.toContain(TOKEN);
    expect(text.toLowerCase()).not.toContain("bearer");
  });

  it("an auth failure is reported without the token and ends the run", async () => {
    const client = createStartggClient({
      token: TOKEN,
      ...fakeTime(),
      logger: () => undefined,
      fetch: async () =>
        new Response(JSON.stringify({ message: `Invalid authentication token ${TOKEN}` }), {
          status: 401,
        }),
    });
    const result = await runLiveCheck(client);
    expect(result.requestsUsed).toBe(1);
    expect(result.errors[0]?.name).toBe("StartggAuthError");
    expect(renderReport(result) + JSON.stringify(result)).not.toContain(TOKEN);
  });
});

describe("scrubRecorded", () => {
  it("anonymises tags by player id, blanks prefixes and user slugs, keeps tournament slugs", () => {
    const player = { id: 7, gamerTag: "Real", prefix: "TSM", user: { slug: "user/abc" } };
    const scrubbed = {
      id: 7,
      gamerTag: "Player 7",
      prefix: "scrubbed",
      user: { slug: "scrubbed" },
    };
    expect(scrubRecorded({ a: player, b: player, tournament: { slug: "tournament/x" } })).toEqual({
      a: scrubbed,
      b: scrubbed,
      tournament: { slug: "tournament/x" },
    });
  });
});

describe("live-check script", () => {
  const runScript = (args: string[]) => {
    const env = { ...process.env };
    delete env["STARTGG_TOKEN"];
    return spawnSync("pnpm", ["exec", "tsx", "scripts/live-check.ts", ...args], {
      cwd: new URL("..", import.meta.url),
      env,
      encoding: "utf8",
    });
  };
  it("fails fast with a clear message when STARTGG_TOKEN is missing, before any request", () => {
    const run = runScript([]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("STARTGG_TOKEN");
    expect(run.stdout).toBe("");
  }, 30_000);

  it("accepts the literal -- that pnpm passes, with --out", () => {
    const run = runScript(["--", "--out", "report.md"]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("STARTGG_TOKEN");
    expect(run.stderr).not.toContain("Bad arguments");
  }, 30_000);
});

describe("parseLiveCheckArgs", () => {
  it("defaults, strips a leading --, and reads the flags", () => {
    expect(parseLiveCheckArgs([])).toMatchObject({ maxRequests: 25, record: false });
    expect(parseLiveCheckArgs(["--", "--out", "x.md", "--record", "--event", "42"])).toEqual({
      out: "x.md",
      record: true,
      maxRequests: 25,
      event: 42,
    });
  });
  it("rejects a bad --max-requests instead of disabling the cap", () => {
    for (const bad of ["abc", "0", "-3", "1.5", "51", ""]) {
      expect(() => parseLiveCheckArgs(["--max-requests", bad])).toThrow();
    }
    expect(parseLiveCheckArgs(["--max-requests", "50"]).maxRequests).toBe(50);
  });
  it("rejects a bad --event", () => {
    expect(() => parseLiveCheckArgs(["--event", "x"])).toThrow();
  });
});
