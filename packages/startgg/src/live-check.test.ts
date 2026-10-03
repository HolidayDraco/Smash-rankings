import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createStartggClient } from "./client";
import { renderReport, runLiveCheck, scrubRecorded } from "./live-check";

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
  idsAsStrings?: boolean;
  noTexasEvent?: boolean;
  rateLimitFirst?: boolean;
}

function fakeClient(world: World = {}) {
  const queries: string[] = [];
  const id = (n: number) => (world.idsAsStrings ? String(n) : n);
  let limited = world.rateLimitFirst ?? false;
  const tournament = (n: number, state: string) => ({
    id: id(n),
    name: "T",
    slug: "t",
    countryCode: world.countryCode ?? "US",
    addrState: state,
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
  const respond = (body: { query: string }): { status?: number; json: Json } => {
    queries.push(body.query);
    if (body.query.includes("LiveCheckSchema")) {
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
    if (body.query.includes("LiveCheckTexas")) {
      return {
        json: {
          data: {
            tournaments: { pageInfo: { total: 120, totalPages: 6 }, nodes: [tournament(5, "TX")] },
          },
        },
      };
    }
    if (body.query.includes("TournamentsPage")) {
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
    if (body.query.includes("EventSetsPage")) {
      return {
        json: {
          data: {
            event: {
              id: id(1),
              sets: {
                pageInfo: { total: 31, totalPages: 1 },
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
      const { status = 200, json } = respond(JSON.parse(String(init.body)) as { query: string });
      return new Response(JSON.stringify(json), { status });
    },
  });
  return { client, queries };
}

describe("live check report", () => {
  it("answers the addrState filter question yes, and probes it", async () => {
    const { client, queries } = fakeClient({ addrStateFilter: true });
    const result = await runLiveCheck(client);
    expect(result.schema).toMatchObject({
      hasAddrStateFilter: true,
      hasUpdatedAfter: true,
      hasSetStateFilter: true,
    });
    expect(result.schema?.eventTypeDescription).toContain("Type of event");
    expect(result.texasFilterProbe).toMatchObject({ total: 120, accepted: 1 });
    expect(queries.some((q) => q.includes("LiveCheckTexas"))).toBe(true);
    expect(renderReport(result)).toContain("addrState (filter by state on start.gg's side): YES");
  });

  it("answers no, and sends no Texas probe", async () => {
    const { client, queries } = fakeClient({ addrStateFilter: false });
    const result = await runLiveCheck(client);
    expect(result.schema?.hasAddrStateFilter).toBe(false);
    expect(queries.some((q) => q.includes("LiveCheckTexas"))).toBe(false);
    expect(renderReport(result)).toContain("addrState (filter by state on start.gg's side): no");
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
    expect(odd.tournaments?.texasLookingRejected).toEqual(["TEX."]);
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

  it("summarises the sample event: totals, slug visibility, DQ signals", async () => {
    const result = await runLiveCheck(fakeClient().client);
    expect(result.event).toMatchObject({
      eventType: 1,
      completedSetsTotal: 31,
      standingsTotal: 32,
      setsOnPage: 2,
      userSlugVisible: { visible: 3, players: 3 },
    });
    expect(result.event?.objectsPerSetsPage).toBeGreaterThan(10);
    expect(result.event?.dq).toMatchObject({
      displayScoreDq: 1,
      scoreMinusOne: 1,
      completedAtNull: 0,
      winnerIdNull: 0,
    });
    expect(result.event?.dq.examples[0]).toMatchObject({ id: 101, displayScore: "DQ" });
    expect(result.steps.map((s) => s.step)).toEqual([
      "LiveCheckSchema",
      "TournamentsPage",
      "EventSetsPage",
      "EventStandingsPage",
    ]);
    expect(result.requestsUsed).toBe(4);
  });

  it("explains when no Texas event is found, within the page cap", async () => {
    const result = await runLiveCheck(fakeClient({ noTexasEvent: true }).client);
    expect(result.event).toBeNull();
    expect(result.noEventReason).toContain("No completed in-person Texas");
    expect(result.requestsUsed).toBe(7); // schema + page cap, not the 35 pages that exist
  });

  it("counts retries toward the request total", async () => {
    const result = await runLiveCheck(fakeClient({ rateLimitFirst: true }).client);
    expect(result.requestsUsed).toBe(5); // includes the retry
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
  it("anonymises tags, prefixes and slugs", () => {
    expect(
      scrubRecorded({ player: { gamerTag: "Real", prefix: "TSM", user: { slug: "user/abc" } } }),
    ).toEqual({
      player: { gamerTag: "Player 1", prefix: "scrubbed", user: { slug: "scrubbed" } },
    });
  });
});

describe("live-check script", () => {
  it("fails fast with a clear message when STARTGG_TOKEN is missing, before any request", () => {
    const env = { ...process.env };
    delete env["STARTGG_TOKEN"];
    const run = spawnSync("pnpm", ["exec", "tsx", "scripts/live-check.ts"], {
      cwd: new URL("..", import.meta.url),
      env,
      encoding: "utf8",
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("STARTGG_TOKEN");
    expect(run.stdout).toBe("");
  }, 30_000);
});
