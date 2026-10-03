// First live check against start.gg (P1-12). Library part: everything goes through the client
// (rate limited, token redacted), so tests drive it with a fake fetch. See scripts/live-check.ts.
import { print } from "graphql";
import { z } from "zod";
import { isInLaunchRegion, isSinglesEvent, ULTIMATE_VIDEOGAME_ID } from "@sr/core";
import {
  EventSetsPageDocument,
  EventStandingsPageDocument,
  TournamentsPageDocument,
} from "./generated/graphql";
import { StartggAuthError, StartggComplexityError, type StartggClient } from "./client";
import { setsDataSchema, standingsDataSchema, tournamentsDataSchema } from "./schemas";

export const DEFAULT_LIVE_CHECK_BUDGET = 25;
const MAX_TOURNAMENT_PAGES = 6;
const WINDOW_DAYS = 14;

const typeRef: z.ZodType<{ kind?: string; name?: string | null; ofType?: unknown }> = z.lazy(() =>
  z.object({ kind: z.string().optional(), name: z.string().nullish(), ofType: typeRef.nullish() }),
);
const inputFields = z.object({
  inputFields: z.array(z.object({ name: z.string(), type: typeRef })).nullable(),
});
const introspectionSchema = z.object({
  tf: inputFields.nullable(),
  sf: inputFields.nullable(),
  ev: z
    .object({ fields: z.array(z.object({ name: z.string(), description: z.string().nullish() })) })
    .nullable(),
});

const SCHEMA_QUERY = `query LiveCheckSchema {
  tf: __type(name: "TournamentPageFilter") { inputFields { name type { kind name ofType { kind name ofType { kind name } } } } }
  sf: __type(name: "SetFilters") { inputFields { name type { kind name ofType { kind name ofType { kind name } } } } }
  ev: __type(name: "Event") { fields { name description } }
}`;

// Same fields the sync job needs, with the server-side state filter. Only sent if introspection says it exists.
const TEXAS_PROBE_QUERY = `query LiveCheckTexas($page: Int!, $perPage: Int!, $videogameIds: [ID], $afterDate: Timestamp, $beforeDate: Timestamp, $addrState: String) {
  tournaments(query: { page: $page, perPage: $perPage, sortBy: "startAt asc", filter: { videogameIds: $videogameIds, afterDate: $afterDate, beforeDate: $beforeDate, addrState: $addrState } }) {
    pageInfo { total totalPages }
    nodes { id countryCode addrState isOnline events(filter: { videogameId: $videogameIds }) { id numEntrants isOnline state type teamRosterSize { maxPlayers } videogame { id } } }
  }
}`;

// Loose shapes: ids may be numbers or strings (that is one of the things we check).
const looseId = z.union([z.number(), z.string()]);
const looseEvent = z.object({
  id: looseId,
  numEntrants: z.number().nullish(),
  isOnline: z.boolean().nullish(),
  state: z.string().nullish(),
  type: z.number().nullish(),
  teamRosterSize: z.object({ maxPlayers: z.number().nullish() }).nullish(),
  videogame: z.object({ id: looseId.nullish() }).nullish(),
});
const looseTournaments = z.object({
  tournaments: z
    .object({
      pageInfo: z
        .object({ total: z.number().nullish(), totalPages: z.number().nullish() })
        .nullish(),
      nodes: z.array(
        z
          .object({
            id: looseId,
            countryCode: z.string().nullish(),
            addrState: z.string().nullish(),
            isOnline: z.boolean().nullish(),
            events: z.array(looseEvent.nullable()).nullish(),
          })
          .nullable(),
      ),
    })
    .nullable(),
});
const looseSets = z.object({
  event: z
    .object({
      sets: z
        .object({
          pageInfo: z.object({ total: z.number().nullish() }).nullish(),
          nodes: z.array(
            z
              .object({
                id: looseId,
                completedAt: z.number().nullish(),
                winnerId: looseId.nullish(),
                displayScore: z.string().nullish(),
                slots: z
                  .array(
                    z
                      .object({
                        entrant: z
                          .object({
                            id: looseId,
                            participants: z
                              .array(
                                z
                                  .object({
                                    player: z
                                      .object({
                                        id: looseId,
                                        user: z.object({ slug: z.string().nullish() }).nullish(),
                                      })
                                      .nullish(),
                                  })
                                  .nullable(),
                              )
                              .nullish(),
                          })
                          .nullish(),
                        standing: z
                          .object({
                            stats: z
                              .object({
                                score: z.object({ value: z.number().nullish() }).nullish(),
                              })
                              .nullish(),
                          })
                          .nullish(),
                      })
                      .nullable(),
                  )
                  .nullish(),
              })
              .nullable(),
          ),
        })
        .nullable(),
    })
    .nullable(),
});
const looseStandings = z.object({
  event: z
    .object({
      standings: z
        .object({
          pageInfo: z.object({ total: z.number().nullish() }).nullish(),
          nodes: z.array(
            z
              .object({
                placement: z.number().nullish(),
                entrant: z.object({ id: looseId }).nullish(),
              })
              .nullable(),
          ),
        })
        .nullable(),
    })
    .nullable(),
});

export type IdKind = "number" | "string" | "mixed";
export interface LiveCheckResult {
  requestsUsed: number;
  budget: number;
  stoppedForBudget: boolean;
  /** Request count per step, in order. */
  steps: { step: string; requests: number }[];
  errors: { step: string; name: string; message: string }[];
  schema: null | {
    tournamentFilterFields: string[];
    hasAddrStateFilter: boolean;
    hasCountryCodeFilter: boolean;
    setFilterFields: string[];
    hasUpdatedAfter: boolean;
    hasSetStateFilter: boolean;
    eventTypeDescription: string | null;
  };
  texasFilterProbe: null | { total: number | null; accepted: number; sampled: number };
  tournaments: null | {
    sampled: number;
    totalInWindow: number | null;
    addrStates: Record<string, number>;
    countryCodes: Record<string, number>;
    acceptedByLaunchRegion: number;
    texasLookingRejected: string[];
  };
  idKinds: Record<string, IdKind>;
  typedSchemaAccepts: { tournaments?: boolean; sets?: boolean; standings?: boolean };
  event: null | {
    id: string | number;
    eventType: number | null;
    setsPageSize: number;
    setsOnPage: number;
    completedSetsTotal: number | null;
    objectsPerSetsPage: number;
    standingsPageSize: number;
    standingsOnPage: number;
    standingsTotal: number | null;
    objectsPerStandingsPage: number;
    userSlugVisible: { visible: number; players: number };
    dq: {
      displayScoreDq: number;
      scoreMinusOne: number;
      completedAtNull: number;
      winnerIdNull: number;
      examples: { id: string | number; displayScore: string | null; winnerId: unknown }[];
    };
  };
  noEventReason: string | null;
}

export interface LiveCheckOptions {
  budget?: number;
  /** Epoch ms; injectable for tests. */
  now?: number;
  /** Receives each raw (unscrubbed) response, for --record. */
  onRaw?: (name: string, data: unknown) => void;
}

class BudgetExceeded extends Error {}

/** Rough count of JSON objects in a response (start.gg counts nested objects toward its 1,000 limit). */
export function countObjects(value: unknown): number {
  if (Array.isArray(value)) return value.reduce<number>((n, v) => n + countObjects(v), 0);
  if (value !== null && typeof value === "object") {
    return 1 + Object.values(value).reduce<number>((n, v) => n + countObjects(v), 0);
  }
  return 0;
}

/** Remove personal data from a recorded response: tags, prefixes, user slugs. */
export function scrubRecorded(value: unknown, counter = { n: 0 }): unknown {
  if (Array.isArray(value)) return value.map((v) => scrubRecorded(v, counter));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (key === "gamerTag" && typeof inner === "string") out[key] = `Player ${++counter.n}`;
      else if (key === "prefix" || key === "slug") out[key] = inner === null ? null : "scrubbed";
      else out[key] = scrubRecorded(inner, counter);
    }
    return out;
  }
  return value;
}

const typeLabel = (type: z.infer<typeof typeRef>): string => {
  if (type.name) return type.name;
  const inner = type.ofType ? typeLabel(type.ofType as z.infer<typeof typeRef>) : "?";
  return type.kind === "LIST" ? `[${inner}]` : inner;
};

export async function runLiveCheck(
  client: Pick<StartggClient, "rawQuery" | "requestsUsed">,
  options: LiveCheckOptions = {},
): Promise<LiveCheckResult> {
  const budget = options.budget ?? DEFAULT_LIVE_CHECK_BUDGET;
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  const window = { afterDate: nowSeconds - WINDOW_DAYS * 86_400, beforeDate: nowSeconds };
  const result: LiveCheckResult = {
    requestsUsed: 0,
    budget,
    stoppedForBudget: false,
    steps: [],
    errors: [],
    schema: null,
    texasFilterProbe: null,
    tournaments: null,
    idKinds: {},
    typedSchemaAccepts: {},
    event: null,
    noEventReason: null,
  };
  const idTypes = new Map<string, Set<string>>();
  const noteId = (label: string, value: unknown) => {
    if (value === null || value === undefined) return;
    const set = idTypes.get(label) ?? new Set<string>();
    set.add(typeof value);
    idTypes.set(label, set);
  };

  async function call(step: string, query: string, variables: Record<string, unknown>) {
    if (client.requestsUsed >= budget) throw new BudgetExceeded();
    const before = client.requestsUsed;
    try {
      const data = await client.rawQuery(step, query, variables);
      options.onRaw?.(step, data);
      return data;
    } finally {
      result.steps.push({ step, requests: client.requestsUsed - before });
    }
  }
  /** Page 1 of a paged query; halves the page size on a complexity error, like the real client. */
  async function firstPage(
    step: string,
    query: string,
    variables: Record<string, unknown>,
    perPage: number,
  ) {
    for (let size = perPage; ; size = Math.max(1, Math.floor(size / 2))) {
      try {
        return {
          data: await call(step, query, { ...variables, page: 1, perPage: size }),
          perPage: size,
        };
      } catch (error) {
        if (!(error instanceof StartggComplexityError) || size <= 1) throw error;
      }
    }
  }
  /** Run a step; record its error and carry on. Budget and auth errors end the run. */
  async function attempt<T>(step: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (result.stoppedForBudget) return undefined;
    try {
      return await fn();
    } catch (error) {
      if (error instanceof BudgetExceeded) {
        result.stoppedForBudget = true;
        return undefined;
      }
      const name = error instanceof Error ? error.name : "Error";
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push({ step, name, message });
      if (error instanceof StartggAuthError) result.stoppedForBudget = true; // no point continuing
      return undefined;
    }
  }

  // 1. Schema facts, one request.
  await attempt("schema", async () => {
    const parsed = introspectionSchema.parse(await call("LiveCheckSchema", SCHEMA_QUERY, {}));
    const names = (f: z.infer<typeof inputFields> | null) =>
      (f?.inputFields ?? []).map((x) => `${x.name}: ${typeLabel(x.type)}`);
    const tf = names(parsed.tf);
    const sf = names(parsed.sf);
    const has = (list: string[], field: string) => list.some((x) => x.startsWith(`${field}:`));
    result.schema = {
      tournamentFilterFields: tf,
      hasAddrStateFilter: has(tf, "addrState"),
      hasCountryCodeFilter: has(tf, "countryCode"),
      setFilterFields: sf,
      hasUpdatedAfter: has(sf, "updatedAfter"),
      hasSetStateFilter: has(sf, "state"),
      eventTypeDescription: parsed.ev?.fields.find((f) => f.name === "type")?.description ?? null,
    };
  });

  // 2. Recent Ultimate tournaments: location format, id types, candidate event.
  type Tournament = NonNullable<
    NonNullable<z.infer<typeof looseTournaments>["tournaments"]>["nodes"][number]
  >;
  const seen: Tournament[] = [];
  let candidate: { eventId: string | number; type: number | null } | null = null;
  const findCandidate = (list: Tournament[]) => {
    for (const t of list) {
      if (!isInLaunchRegion({ countryCode: t.countryCode ?? null, addrState: t.addrState ?? null }))
        continue;
      for (const e of t.events ?? []) {
        if (!e || e.state !== "COMPLETED" || (e.numEntrants ?? 0) < 16 || e.isOnline) continue;
        if (
          e.videogame?.id !== undefined &&
          e.videogame?.id !== null &&
          Number(e.videogame.id) !== ULTIMATE_VIDEOGAME_ID
        )
          continue;
        if (
          !isSinglesEvent({
            type: e.type ?? null,
            teamRosterSize: e.teamRosterSize
              ? { maxPlayers: e.teamRosterSize.maxPlayers ?? null }
              : null,
          })
        )
          continue;
        return { eventId: e.id, type: e.type ?? null };
      }
    }
    return null;
  };
  const absorb = (data: unknown, label: string) => {
    const parsed = looseTournaments.parse(data);
    const nodes = (parsed.tournaments?.nodes ?? []).filter((n): n is Tournament => n !== null);
    for (const t of nodes) {
      noteId("tournament id", t.id);
      for (const e of t.events ?? []) noteId("event id", e?.id);
    }
    if (label === "main") seen.push(...nodes);
    return { nodes, parsed };
  };
  const tournamentVars = { videogameIds: [ULTIMATE_VIDEOGAME_ID], ...window };
  const tournamentsQuery = print(TournamentsPageDocument);
  let totalPages = 1;
  await attempt("tournaments", async () => {
    const { data } = await firstPage("TournamentsPage", tournamentsQuery, tournamentVars, 20);
    result.typedSchemaAccepts.tournaments = tournamentsDataSchema.safeParse(data).success;
    const { parsed } = absorb(data, "main");
    totalPages = parsed.tournaments?.pageInfo?.totalPages ?? 1;
    result.tournaments = {
      sampled: 0,
      totalInWindow: parsed.tournaments?.pageInfo?.total ?? null,
      addrStates: {},
      countryCodes: {},
      acceptedByLaunchRegion: 0,
      texasLookingRejected: [],
    };
    candidate = findCandidate(seen);
  });

  // 3. If the server can filter by state, try it once: it also finds a Texas event faster.
  if (result.schema?.hasAddrStateFilter && result.tournaments) {
    await attempt("texas filter", async () => {
      const { data } = await firstPage(
        "LiveCheckTexas",
        TEXAS_PROBE_QUERY,
        { ...tournamentVars, addrState: "TX" },
        20,
      );
      const { nodes, parsed } = absorb(data, "probe");
      result.texasFilterProbe = {
        total: parsed.tournaments?.pageInfo?.total ?? null,
        sampled: nodes.length,
        accepted: nodes.filter((t) =>
          isInLaunchRegion({ countryCode: t.countryCode ?? null, addrState: t.addrState ?? null }),
        ).length,
      };
      candidate ??= findCandidate(nodes);
    });
  }

  // 4. Walk a few more pages only if no Texas candidate yet.
  for (let page = 2; !candidate && page <= Math.min(totalPages, MAX_TOURNAMENT_PAGES); page++) {
    await attempt("tournaments", async () => {
      const { data } = await firstPageAt(page);
      candidate = findCandidate(absorb(data, "main").nodes);
    });
  }
  async function firstPageAt(page: number) {
    const data = await call("TournamentsPage", tournamentsQuery, {
      ...tournamentVars,
      page,
      perPage: 20,
    });
    return { data };
  }

  if (result.tournaments) {
    const t = result.tournaments;
    t.sampled = seen.length;
    for (const n of seen) {
      const state = n.addrState ?? "(none)";
      const country = n.countryCode ?? "(none)";
      t.addrStates[state] = (t.addrStates[state] ?? 0) + 1;
      t.countryCodes[country] = (t.countryCodes[country] ?? 0) + 1;
      const accepted = isInLaunchRegion({
        countryCode: n.countryCode ?? null,
        addrState: n.addrState ?? null,
      });
      if (accepted) t.acceptedByLaunchRegion++;
      else if (
        /tex/i.test(n.addrState ?? "") &&
        !t.texasLookingRejected.includes(n.addrState ?? "")
      ) {
        t.texasLookingRejected.push(n.addrState ?? "");
      }
    }
  }

  // 5. One completed Texas 16+ singles event: sets and standings.
  const chosen = candidate as { eventId: string | number; type: number | null } | null;
  if (!chosen) {
    result.noEventReason = result.tournaments
      ? "No completed in-person Texas singles event with 16+ entrants was on the pages we read."
      : "The tournaments request failed, so no event could be chosen.";
  } else if (!result.stoppedForBudget) {
    const eventVars = { eventId: chosen.eventId };
    const sets = await attempt("sets", async () =>
      firstPage("EventSetsPage", print(EventSetsPageDocument), eventVars, 40),
    );
    const standings = await attempt("standings", async () =>
      firstPage("EventStandingsPage", print(EventStandingsPageDocument), eventVars, 100),
    );
    if (sets) {
      result.typedSchemaAccepts.sets = setsDataSchema.safeParse(sets.data).success;
      const nodes = (looseSets.parse(sets.data).event?.sets?.nodes ?? []).filter((n) => n !== null);
      const parsedSets = looseSets.parse(sets.data).event?.sets;
      const dq = {
        displayScoreDq: 0,
        scoreMinusOne: 0,
        completedAtNull: 0,
        winnerIdNull: 0,
        examples: [] as { id: string | number; displayScore: string | null; winnerId: unknown }[],
      };
      const players = new Set<string>();
      const withSlug = new Set<string>();
      for (const s of nodes) {
        noteId("set id", s.id);
        noteId("winnerId", s.winnerId);
        const scores = (s.slots ?? []).map((slot) => slot?.standing?.stats?.score?.value);
        const isDq = /dq/i.test(s.displayScore ?? "");
        const minus = scores.some((v) => v === -1);
        const noCompleted = s.completedAt === null || s.completedAt === undefined;
        const noWinner = s.winnerId === null || s.winnerId === undefined;
        if (isDq) dq.displayScoreDq++;
        if (minus) dq.scoreMinusOne++;
        if (noCompleted) dq.completedAtNull++;
        if (noWinner) dq.winnerIdNull++;
        if ((isDq || minus || noCompleted || noWinner) && dq.examples.length < 3) {
          dq.examples.push({
            id: s.id,
            displayScore: s.displayScore ?? null,
            winnerId: s.winnerId ?? null,
          });
        }
        for (const slot of s.slots ?? []) {
          noteId("entrant id", slot?.entrant?.id);
          for (const p of slot?.entrant?.participants ?? []) {
            if (!p?.player) continue;
            noteId("player id", p.player.id);
            players.add(String(p.player.id));
            if (p.player.user?.slug) withSlug.add(String(p.player.id));
          }
        }
      }
      const std = standings && looseStandings.parse(standings.data).event?.standings;
      if (standings)
        result.typedSchemaAccepts.standings = standingsDataSchema.safeParse(standings.data).success;
      result.event = {
        id: chosen.eventId,
        eventType: chosen.type,
        setsPageSize: sets.perPage,
        setsOnPage: nodes.length,
        completedSetsTotal: parsedSets?.pageInfo?.total ?? null,
        objectsPerSetsPage: countObjects(sets.data),
        standingsPageSize: standings?.perPage ?? 0,
        standingsOnPage: std ? std.nodes.length : 0,
        standingsTotal: std ? (std.pageInfo?.total ?? null) : null,
        objectsPerStandingsPage: standings ? countObjects(standings.data) : 0,
        userSlugVisible: { visible: withSlug.size, players: players.size },
        dq,
      };
    }
  }

  for (const [label, kinds] of idTypes) {
    result.idKinds[label] = kinds.size > 1 ? "mixed" : kinds.has("string") ? "string" : "number";
  }
  result.requestsUsed = client.requestsUsed;
  return result;
}

const list = (counts: Record<string, number>) =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `"${k}" x${n}`)
    .join(", ") || "none";
const yesNo = (v: boolean) => (v ? "YES" : "no");

/** Plain-English report (Markdown). Contains no token and no headers. */
export function renderReport(r: LiveCheckResult): string {
  const out: string[] = ["# start.gg live check", ""];
  out.push(
    `Requests used: ${r.requestsUsed} of ${r.budget} allowed.${r.stoppedForBudget ? " The run stopped early (budget reached or token rejected)." : ""}`,
  );
  out.push(`Breakdown: ${r.steps.map((s) => `${s.step} ${s.requests}`).join(", ") || "none"}.`, "");
  if (r.errors.length) {
    out.push("## Errors", ...r.errors.map((e) => `- ${e.step}: ${e.name}: ${e.message}`), "");
  }
  out.push("## Schema (introspection)");
  if (r.schema) {
    const s = r.schema;
    out.push(
      `- Tournament filter has addrState (filter by state on start.gg's side): ${yesNo(s.hasAddrStateFilter)}`,
      `- Tournament filter has countryCode: ${yesNo(s.hasCountryCodeFilter)}`,
      `- Tournament filter fields: ${s.tournamentFilterFields.join(", ") || "none found"}`,
      `- Set filters include updatedAfter: ${yesNo(s.hasUpdatedAfter)}; state: ${yesNo(s.hasSetStateFilter)}`,
      `- Set filter fields: ${s.setFilterFields.join(", ") || "none found"}`,
      `- Event.type description: ${s.eventTypeDescription ?? "(none)"}`,
    );
    if (r.texasFilterProbe) {
      const p = r.texasFilterProbe;
      out.push(
        `- Texas filter probe: ${p.total ?? "?"} Texas tournaments in the window; ${p.accepted} of ${p.sampled} sampled accepted by our region rule.`,
      );
    }
  } else out.push("- Not answered (request failed).");
  out.push("", "## Location format");
  if (r.tournaments) {
    const t = r.tournaments;
    out.push(
      `- Tournaments in the last 14 days (all): ${t.totalInWindow ?? "unknown"}; sampled: ${t.sampled}`,
      `- addrState values seen: ${list(t.addrStates)}`,
      `- countryCode values seen: ${list(t.countryCodes)}`,
      `- Accepted by isInLaunchRegion: ${t.acceptedByLaunchRegion} of ${t.sampled}`,
    );
    if (t.texasLookingRejected.length) {
      out.push(
        `- WARNING: Texas-looking values our rule rejects: ${t.texasLookingRejected.map((v) => `"${v}"`).join(", ")}`,
      );
    }
  } else out.push("- Not answered (request failed).");
  out.push("", "## ID types");
  const kinds = Object.entries(r.idKinds);
  out.push(
    kinds.length ? `- ${kinds.map(([k, v]) => `${k}: ${v}`).join("; ")}` : "- Not answered.",
  );
  const acc = r.typedSchemaAccepts;
  out.push(
    `- Our strict schemas accept the real responses: tournaments ${acc.tournaments ?? "n/a"}, sets ${acc.sets ?? "n/a"}, standings ${acc.standings ?? "n/a"}`,
  );
  out.push("", "## One completed Texas 16+ singles event");
  if (r.event) {
    const e = r.event;
    out.push(
      `- Event id ${e.id}; Event.type = ${e.eventType ?? "null"}`,
      `- Sets: ${e.setsOnPage} on page 1 (page size ${e.setsPageSize}); total completed sets (pageInfo.total): ${e.completedSetsTotal ?? "unknown"}; about ${e.objectsPerSetsPage} objects on the page`,
      `- Standings: ${e.standingsOnPage} on page 1 (page size ${e.standingsPageSize}); total ${e.standingsTotal ?? "unknown"}; about ${e.objectsPerStandingsPage} objects`,
      `- Player.user.slug visible for ${e.userSlugVisible.visible} of ${e.userSlugVisible.players} players`,
      `- DQ signals on page 1: displayScore says DQ ${e.dq.displayScoreDq}; a score of -1 ${e.dq.scoreMinusOne}; completedAt null ${e.dq.completedAtNull}; winnerId null ${e.dq.winnerIdNull}`,
    );
    for (const x of e.dq.examples)
      out.push(
        `  - example set ${x.id}: displayScore ${JSON.stringify(x.displayScore)}, winnerId ${JSON.stringify(x.winnerId)}`,
      );
    if (!e.dq.examples.length) out.push("  - No DQ-looking set on this page; try another event.");
  } else out.push(`- ${r.noEventReason ?? "Not answered."}`);
  return `${out.join("\n")}\n`;
}
