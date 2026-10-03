// First live check against start.gg (P1-12). Library part: everything goes through the client
// (rate limited, token redacted), so tests drive it with a fake fetch. See scripts/live-check.ts.
import { parseArgs } from "node:util";
import { print } from "graphql";
import { z } from "zod";
import {
  isInLaunchRegion,
  isSinglesEvent,
  LAUNCH_REGIONS,
  STATE_NAMES,
  ULTIMATE_VIDEOGAME_ID,
} from "@sr/core";
import {
  EventSetsPageDocument,
  EventStandingsPageDocument,
  TournamentsPageDocument,
} from "./generated/graphql";
import {
  DEFAULT_TOURNAMENTS_PER_PAGE,
  StartggAuthError,
  StartggComplexityError,
  type StartggClient,
} from "./client";
import { setsDataSchema, standingsDataSchema, tournamentsDataSchema } from "./schemas";

export const DEFAULT_LIVE_CHECK_BUDGET = 25;
const MAX_TOURNAMENT_PAGES = 6;
// Same window as the discover job, so the request estimate is the real one.
const DAYS_BACK = 14;
const DAYS_AHEAD = 30;
const REGION_STATE = LAUNCH_REGIONS.states[0];
const REGION_TOKENS = [REGION_STATE, STATE_NAMES[REGION_STATE] ?? REGION_STATE];

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

const typeSelection = "type { kind name ofType { kind name ofType { kind name } } }";
const SCHEMA_QUERY = `query LiveCheckSchema {
  tf: __type(name: "TournamentPageFilter") { inputFields { name ${typeSelection} } }
  sf: __type(name: "SetFilters") { inputFields { name ${typeSelection} } }
  ev: __type(name: "Event") { fields { name description } }
}`;
// Same fields the sync job needs, with the server-side state filter. Only sent if introspection says it exists.
const STATE_PROBE_QUERY = `query LiveCheckState($page: Int!, $perPage: Int!, $videogameIds: [ID], $afterDate: Timestamp, $beforeDate: Timestamp, $addrState: String) {
  tournaments(query: { page: $page, perPage: $perPage, sortBy: "startAt asc", filter: { videogameIds: $videogameIds, afterDate: $afterDate, beforeDate: $beforeDate, addrState: $addrState } }) {
    pageInfo { total totalPages }
    nodes { id countryCode addrState isOnline events(filter: { videogameId: $videogameIds }) { id numEntrants isOnline state type teamRosterSize { maxPlayers } videogame { id } } }
  }
}`;
// Unfiltered set count, to compare with the completed-only count (does `state: [3]` change the total?).
const ALL_SETS_QUERY = `query LiveCheckAllSets($eventId: ID!) { event(id: $eventId) { sets(page: 1, perPage: 1) { pageInfo { total } } } }`;

// Loose shapes with only the fields we read. Ids may be numbers or strings (one of the checks).
const looseId = z.union([z.number(), z.string()]);
const pageInfoShape = z.object({ total: z.number().nullish(), totalPages: z.number().nullish() });
const looseTournaments = z.object({
  tournaments: z
    .object({
      pageInfo: pageInfoShape.nullish(),
      nodes: z.array(
        z
          .object({
            id: looseId,
            countryCode: z.string().nullish(),
            addrState: z.string().nullish(),
            city: z.string().nullish(),
            events: z
              .array(
                z
                  .object({
                    id: looseId,
                    numEntrants: z.number().nullish(),
                    isOnline: z.boolean().nullish(),
                    state: z.string().nullish(),
                    type: z.number().nullish(),
                    teamRosterSize: z.object({ maxPlayers: z.number().nullish() }).nullish(),
                    videogame: z.object({ id: looseId.nullish() }).nullish(),
                  })
                  .nullable(),
              )
              .nullish(),
          })
          .nullable(),
      ),
    })
    .nullable(),
});
type Tournament = NonNullable<
  NonNullable<z.infer<typeof looseTournaments>["tournaments"]>["nodes"][number]
>;
const looseSetNode = z.object({
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
                .object({ score: z.object({ value: z.number().nullish() }).nullish() })
                .nullish(),
            })
            .nullish(),
        })
        .nullable(),
    )
    .nullish(),
});
const looseSets = z.object({
  event: z
    .object({
      sets: z
        .object({ pageInfo: pageInfoShape.nullish(), nodes: z.array(looseSetNode.nullable()) })
        .nullable(),
    })
    .nullable(),
});
const looseAllSets = z.object({
  event: z.object({ sets: z.object({ pageInfo: pageInfoShape.nullish() }).nullable() }).nullable(),
});
const looseStandings = z.object({
  event: z
    .object({
      standings: z
        .object({
          pageInfo: pageInfoShape.nullish(),
          nodes: z.array(z.object({ placement: z.number().nullish() }).nullable()),
        })
        .nullable(),
    })
    .nullable(),
});

export type IdKind = "number" | "string" | "mixed";
interface SetsInfo {
  pageSize: number;
  totalPages: number | null;
  /** Rows on page 1 and on the last page (null when there is only one page). */
  firstPageSets: number;
  lastPageSets: number | null;
  completedTotal: number | null;
  objectsPerPage: number;
  userSlugVisible: { visible: number; players: number };
  dq: {
    displayScoreDq: number;
    scoreMinusOne: number;
    completedAtNull: number;
    winnerIdNull: number;
    examples: { id: string | number; displayScore: string | null; winnerId: unknown }[];
  };
}
export interface LiveCheckResult {
  requestsUsed: number;
  budget: number;
  stoppedForBudget: boolean;
  steps: { step: string; requests: number }[];
  errors: { step: string; name: string; message: string }[];
  /** True when --event picked the event, so it was not checked against the launch rules. */
  eventChosenByFlag: boolean;
  schema: null | {
    tournamentFilterFields: string[];
    hasAddrStateFilter: boolean;
    hasCountryCodeFilter: boolean;
    setFilterFields: string[];
    hasUpdatedAfter: boolean;
    hasSetStateFilter: boolean;
    eventTypeDescription: string | null;
  };
  /** Server-side state filter probe: matching tournaments in the discover window and the requests they cost. */
  stateFilterProbe: null | {
    total: number | null;
    requestsPerRun: number | null;
    accepted: number;
    sampled: number;
  };
  tournaments: null | {
    sampled: number;
    totalInWindow: number | null;
    /** ceil(total / page size): what one discover run costs. */
    discoverRequestsPerRun: number | null;
    addrStates: Record<string, number>;
    /** Up to 10 distinct `city` values from launch-region tournaments (is Tournament.city filled in, and how is it spelled?). */
    citySamples: string[];
    /** Launch-region tournaments whose city came back empty. */
    cityMissing: number;
    countryCodes: Record<string, number>;
    acceptedByLaunchRegion: number;
    regionLookingRejected: string[];
  };
  /** Counts of "type / maxPlayers" over every sampled event. */
  eventTypes: Record<string, number>;
  idKinds: Record<string, IdKind>;
  typedSchemaAccepts: { tournaments?: boolean; sets?: boolean; standings?: boolean };
  event: null | {
    id: string | number;
    sets: SetsInfo | null;
    allSetsTotal: number | null;
    standings: null | { pageSize: number; onPage: number; total: number | null; objects: number };
  };
  noEventReason: string | null;
}

export interface LiveCheckOptions {
  budget?: number;
  /** Epoch ms; injectable for tests. */
  now?: number;
  /** Check this event instead of picking one from the tournaments page. */
  eventId?: number;
  /** Receives each raw (unscrubbed) response, for --record. */
  onRaw?: (name: string, data: unknown) => void;
  /** Extra redaction for messages put in the report (the client already redacts its own). */
  redact?: (text: string) => string;
}

const argsSchema = z.object({
  out: z.string().min(1).optional(),
  record: z.boolean(),
  maxRequests: z.coerce.number().int().min(1).max(50),
  event: z.coerce.number().int().positive().optional(),
});
/** Parse CLI args. pnpm passes a literal leading `--`, which is dropped. Throws a ZodError on bad values. */
export function parseLiveCheckArgs(argv: string[]) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const { values } = parseArgs({
    args,
    options: {
      out: { type: "string" },
      record: { type: "boolean", default: false },
      "max-requests": { type: "string", default: String(DEFAULT_LIVE_CHECK_BUDGET) },
      event: { type: "string" },
    },
  });
  return argsSchema.parse({
    out: values.out,
    record: values.record,
    maxRequests: values["max-requests"],
    event: values.event,
  });
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

/**
 * Remove personal data from a recorded response. Gamer tags become `Player <id>` (stable per
 * player), prefixes and user slugs are blanked. Tournament and event slugs stay (we store them).
 */
export function scrubRecorded(value: unknown, parentKey = ""): unknown {
  if (Array.isArray(value)) return value.map((v) => scrubRecorded(v, parentKey));
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(record)) {
    if (key === "gamerTag" && typeof inner === "string")
      out[key] = `Player ${String(record["id"])}`;
    else if (key === "prefix" || (key === "slug" && parentKey === "user")) {
      out[key] = inner === null ? null : "scrubbed";
    } else out[key] = scrubRecorded(inner, key);
  }
  return out;
}

const typeLabel = (type: z.infer<typeof typeRef>): string => {
  if (type.name) return type.name;
  const inner = type.ofType ? typeLabel(type.ofType as z.infer<typeof typeRef>) : "?";
  return type.kind === "LIST" ? `[${inner}]` : inner;
};
const looksLikeRegion = (value: string) =>
  REGION_TOKENS.some((t) => value.toLowerCase().includes(t.toLowerCase().slice(0, 3)));
const location = (t: Tournament) => ({
  countryCode: t.countryCode ?? null,
  addrState: t.addrState ?? null,
});

export async function runLiveCheck(
  client: Pick<StartggClient, "rawQuery" | "requestsUsed">,
  options: LiveCheckOptions = {},
): Promise<LiveCheckResult> {
  const budget = options.budget ?? DEFAULT_LIVE_CHECK_BUDGET;
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  const window = {
    afterDate: nowSeconds - DAYS_BACK * 86_400,
    beforeDate: nowSeconds + DAYS_AHEAD * 86_400,
  };
  const result: LiveCheckResult = {
    requestsUsed: 0,
    budget,
    stoppedForBudget: false,
    steps: [],
    errors: [],
    schema: null,
    stateFilterProbe: null,
    tournaments: null,
    eventTypes: {},
    idKinds: {},
    typedSchemaAccepts: {},
    event: null,
    noEventReason: null,
    eventChosenByFlag: options.eventId !== undefined,
  };
  const idTypes = new Map<string, Set<string>>();
  const noteId = (label: string, value: unknown) => {
    if (value === null || value === undefined) return;
    idTypes.set(label, (idTypes.get(label) ?? new Set<string>()).add(typeof value));
  };
  const fail = (step: string, name: string, message: string) =>
    result.errors.push({ step, name, message: options.redact?.(message) ?? message });

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
  /** One page; halves the page size on a complexity error, like the real client. */
  async function paged(
    step: string,
    query: string,
    variables: Record<string, unknown>,
    page: number,
    perPage: number,
  ) {
    for (let size = perPage; ; size = Math.max(1, Math.floor(size / 2))) {
      try {
        return {
          data: await call(step, query, { ...variables, page, perPage: size }),
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
      if (error instanceof BudgetExceeded) result.stoppedForBudget = true;
      else {
        fail(
          step,
          error instanceof Error ? error.name : "Error",
          String(error instanceof Error ? error.message : error),
        );
        if (error instanceof StartggAuthError) result.stoppedForBudget = true; // no point continuing
      }
      return undefined;
    }
  }
  function parse<S extends z.ZodType>(
    step: string,
    schema: S,
    data: unknown,
  ): z.infer<S> | undefined {
    const parsed = schema.safeParse(data);
    if (parsed.success) return parsed.data;
    const issue = parsed.error.issues[0];
    fail(
      step,
      "ParseError",
      `unexpected response shape at ${issue?.path.join(".") ?? "?"}: ${issue?.message ?? "invalid"}`,
    );
    return undefined;
  }

  try {
    await run();
  } catch (error) {
    fail(
      "unexpected",
      error instanceof Error ? error.name : "Error",
      String(error instanceof Error ? error.message : error),
    );
  }
  for (const [label, kinds] of idTypes) {
    result.idKinds[label] = kinds.size > 1 ? "mixed" : kinds.has("string") ? "string" : "number";
  }
  result.requestsUsed = client.requestsUsed;
  return result;

  async function run() {
    // 1. Schema facts, one request.
    await attempt("schema", async () => {
      const parsed = parse(
        "schema",
        introspectionSchema,
        await call("LiveCheckSchema", SCHEMA_QUERY, {}),
      );
      if (!parsed) return;
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

    // 2. Recent Ultimate tournaments: location format, id types, event types, candidate event.
    const seen: Tournament[] = [];
    let candidate: { eventId: string | number } | null =
      options.eventId === undefined ? null : { eventId: options.eventId };
    const findCandidate = (list: Tournament[]) => {
      for (const t of list) {
        if (!isInLaunchRegion(location(t))) continue;
        for (const e of t.events ?? []) {
          if (!e || e.state !== "COMPLETED" || (e.numEntrants ?? 0) < 16 || e.isOnline) continue;
          if (e.videogame?.id != null && Number(e.videogame.id) !== ULTIMATE_VIDEOGAME_ID) continue;
          const roster = e.teamRosterSize
            ? { maxPlayers: e.teamRosterSize.maxPlayers ?? null }
            : null;
          if (isSinglesEvent({ type: e.type ?? null, teamRosterSize: roster })) {
            return { eventId: e.id };
          }
        }
      }
      return null;
    };
    const absorb = (data: unknown, isMain: boolean) => {
      const parsed = parse("tournaments", looseTournaments, data)?.tournaments;
      if (!parsed) return null;
      const nodes = parsed.nodes.filter((n): n is Tournament => n !== null);
      for (const t of nodes) {
        noteId("tournament id", t.id);
        for (const e of t.events ?? []) {
          if (!e) continue;
          noteId("event id", e.id);
          const key = `type ${e.type ?? "null"} / max players ${e.teamRosterSize?.maxPlayers ?? "null"}`;
          result.eventTypes[key] = (result.eventTypes[key] ?? 0) + 1;
        }
      }
      if (isMain) seen.push(...nodes);
      return { nodes, pageInfo: parsed.pageInfo };
    };
    const tournamentVars = { videogameIds: [ULTIMATE_VIDEOGAME_ID], ...window };
    const tournamentsQuery = print(TournamentsPageDocument);
    let totalPages = 1;
    let perPage: number = DEFAULT_TOURNAMENTS_PER_PAGE;
    await attempt("tournaments", async () => {
      const first = await paged("TournamentsPage", tournamentsQuery, tournamentVars, 1, perPage);
      perPage = first.perPage;
      result.typedSchemaAccepts.tournaments = tournamentsDataSchema.safeParse(first.data).success;
      const page = absorb(first.data, true);
      if (!page) return;
      const total = page.pageInfo?.total ?? null;
      totalPages = page.pageInfo?.totalPages ?? 1;
      result.tournaments = {
        sampled: 0,
        totalInWindow: total,
        discoverRequestsPerRun:
          total === null ? null : Math.ceil(total / DEFAULT_TOURNAMENTS_PER_PAGE),
        addrStates: {},
        citySamples: [],
        cityMissing: 0,
        countryCodes: {},
        acceptedByLaunchRegion: 0,
        regionLookingRejected: [],
      };
      candidate ??= findCandidate(seen);
    });

    // 3. If the server can filter by state, try it once: it also finds an event faster.
    // If introspection was blocked (schema unknown), send the probe anyway: its success or
    // validation error is the answer to the key P1-12 question.
    if ((result.schema === null || result.schema.hasAddrStateFilter) && result.tournaments) {
      await attempt("state filter", async () => {
        const vars = { ...tournamentVars, addrState: REGION_STATE };
        const { data } = await paged("LiveCheckState", STATE_PROBE_QUERY, vars, 1, perPage);
        const page = absorb(data, false);
        if (!page) return;
        const total = page.pageInfo?.total ?? null;
        result.stateFilterProbe = {
          total,
          requestsPerRun: total === null ? null : Math.ceil(total / DEFAULT_TOURNAMENTS_PER_PAGE),
          sampled: page.nodes.length,
          accepted: page.nodes.filter((t) => isInLaunchRegion(location(t))).length,
        };
        candidate ??= findCandidate(page.nodes);
      });
    }

    // 4. Read a few more pages (at the page size that worked) only if no candidate yet.
    for (let page = 2; !candidate && page <= Math.min(totalPages, MAX_TOURNAMENT_PAGES); page++) {
      await attempt("tournaments", async () => {
        const next = await paged(
          "TournamentsPage",
          tournamentsQuery,
          tournamentVars,
          page,
          perPage,
        );
        perPage = next.perPage;
        const parsed = absorb(next.data, true);
        if (parsed) candidate = findCandidate(parsed.nodes);
      });
    }

    if (result.tournaments) {
      const t = result.tournaments;
      t.sampled = seen.length;
      for (const n of seen) {
        const state = n.addrState ?? "(none)";
        const country = n.countryCode ?? "(none)";
        t.addrStates[state] = (t.addrStates[state] ?? 0) + 1;
        t.countryCodes[country] = (t.countryCodes[country] ?? 0) + 1;
        if (isInLaunchRegion(location(n))) {
          t.acceptedByLaunchRegion++;
          const city = n.city?.trim();
          if (!city) t.cityMissing++;
          else if (t.citySamples.length < 10 && !t.citySamples.includes(city))
            t.citySamples.push(city);
        } else if (
          n.addrState &&
          looksLikeRegion(n.addrState) &&
          !t.regionLookingRejected.includes(n.addrState)
        ) {
          t.regionLookingRejected.push(n.addrState);
        }
      }
    }

    // 5. One completed launch-region 16+ singles event: sets (first and last page), counts, standings.
    const chosen = candidate as { eventId: string | number } | null;
    if (!chosen) {
      result.noEventReason = result.tournaments
        ? `No completed in-person ${REGION_STATE} singles event with 16+ entrants was on the pages we read.`
        : "The tournaments request failed, so no event could be chosen.";
      return;
    }
    if (result.stoppedForBudget) return;
    const eventVars = { eventId: chosen.eventId };
    const event: NonNullable<LiveCheckResult["event"]> = {
      id: chosen.eventId,
      sets: null,
      allSetsTotal: null,
      standings: null,
    };
    result.event = event;

    event.sets =
      (await attempt("sets", async (): Promise<SetsInfo | undefined> => {
        const setsQuery = print(EventSetsPageDocument);
        const first = await paged("EventSetsPage", setsQuery, eventVars, 1, 40);
        result.typedSchemaAccepts.sets = setsDataSchema.safeParse(first.data).success;
        const firstEvent = parse("sets", looseSets, first.data)?.event;
        if (firstEvent === null)
          fail("sets", "NotFound", `event ${String(chosen.eventId)} not found`);
        const firstSets = firstEvent?.sets;
        if (!firstSets) return undefined;
        const pages = [firstSets.nodes];
        const sets = firstSets.pageInfo?.totalPages ?? null;
        let lastCount: number | null = null;
        if (sets !== null && sets > 1) {
          // Round-1 DQs sit on the last page of a RECENT-sorted list.
          const last = await attempt("sets (last page)", async () =>
            paged("EventSetsPage", setsQuery, eventVars, sets, first.perPage),
          );
          const lastSets = last && parse("sets (last page)", looseSets, last.data)?.event?.sets;
          if (lastSets) {
            pages.push(lastSets.nodes);
            lastCount = lastSets.nodes.length;
          }
        }
        return summarizeSets(
          pages.flat().filter((n) => n !== null),
          {
            pageSize: first.perPage,
            totalPages: sets,
            firstPageSets: firstSets.nodes.length,
            lastPageSets: lastCount,
            completedTotal: firstSets.pageInfo?.total ?? null,
            objectsPerPage: countObjects(first.data),
          },
        );
      })) ?? null;

    const all = await attempt("all sets", async () =>
      parse("all sets", looseAllSets, await call("LiveCheckAllSets", ALL_SETS_QUERY, eventVars)),
    );
    event.allSetsTotal = all?.event?.sets?.pageInfo?.total ?? null;

    event.standings =
      (await attempt("standings", async () => {
        const res = await paged(
          "EventStandingsPage",
          print(EventStandingsPageDocument),
          eventVars,
          1,
          100,
        );
        result.typedSchemaAccepts.standings = standingsDataSchema.safeParse(res.data).success;
        const std = parse("standings", looseStandings, res.data)?.event?.standings;
        if (!std) return undefined;
        return {
          pageSize: res.perPage,
          onPage: std.nodes.length,
          total: std.pageInfo?.total ?? null,
          objects: countObjects(res.data),
        };
      })) ?? null;
  }

  function summarizeSets(
    nodes: z.infer<typeof looseSetNode>[],
    base: Pick<
      SetsInfo,
      | "pageSize"
      | "totalPages"
      | "firstPageSets"
      | "lastPageSets"
      | "completedTotal"
      | "objectsPerPage"
    >,
  ): SetsInfo {
    const dq: SetsInfo["dq"] = {
      displayScoreDq: 0,
      scoreMinusOne: 0,
      completedAtNull: 0,
      winnerIdNull: 0,
      examples: [],
    };
    const players = new Set<string>();
    const withSlug = new Set<string>();
    for (const s of nodes) {
      noteId("set id", s.id);
      noteId("winnerId", s.winnerId);
      const isDq = /dq/i.test(s.displayScore ?? "");
      const minus = (s.slots ?? []).some((slot) => slot?.standing?.stats?.score?.value === -1);
      const noCompleted = s.completedAt == null;
      const noWinner = s.winnerId == null;
      dq.displayScoreDq += Number(isDq);
      dq.scoreMinusOne += Number(minus);
      dq.completedAtNull += Number(noCompleted);
      dq.winnerIdNull += Number(noWinner);
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
    return { ...base, userSlugVisible: { visible: withSlug.size, players: players.size }, dq };
  }
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
    `Requests used: ${r.requestsUsed} of ${r.budget} allowed (retries can add a couple).${r.stoppedForBudget ? " The run stopped early (budget reached or token rejected)." : ""}`,
    `Breakdown: ${r.steps.map((s) => `${s.step} ${s.requests}`).join(", ") || "none"}.`,
    "",
  );
  if (r.errors.length)
    out.push("## Errors", ...r.errors.map((e) => `- ${e.step}: ${e.name}: ${e.message}`), "");
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
    if (r.stateFilterProbe) {
      const p = r.stateFilterProbe;
      out.push(
        `- ${REGION_STATE} filter probe: ${p.total ?? "?"} ${REGION_STATE} tournaments in the window, so about ${p.requestsPerRun ?? "?"} requests for a filtered discover or backfill pass; ${p.accepted} of ${p.sampled} sampled accepted by our region rule.`,
      );
    }
  } else out.push("- Not answered (request failed).");
  out.push("", "## Discover cost and location format");
  if (r.tournaments) {
    const t = r.tournaments;
    out.push(
      `- Ultimate tournaments in the discover window (${DAYS_BACK} days back, ${DAYS_AHEAD} ahead): ${t.totalInWindow ?? "unknown"}, so discover requests per run: ${t.discoverRequestsPerRun ?? "unknown"} (the daily target is 50)`,
      `- Sampled: ${t.sampled}`,
      `- addrState values seen: ${list(t.addrStates)}`,
      `- countryCode values seen: ${list(t.countryCodes)}`,
      `- city values seen in launch-region tournaments (sample): ${t.citySamples.map((c) => `"${c}"`).join(", ") || "none"}; empty city: ${t.cityMissing}`,
      `- Accepted by isInLaunchRegion: ${t.acceptedByLaunchRegion} of ${t.sampled}`,
    );
    if (t.regionLookingRejected.length) {
      out.push(
        `- WARNING: region-looking values our rule rejects: ${t.regionLookingRejected.map((v) => `"${v}"`).join(", ")}`,
      );
    }
  } else out.push("- Not answered (request failed).");
  out.push("", "## Event types seen (Event.type / team roster size)", `- ${list(r.eventTypes)}`);
  out.push("", "## ID types");
  const kinds = Object.entries(r.idKinds);
  out.push(
    kinds.length ? `- ${kinds.map(([k, v]) => `${k}: ${v}`).join("; ")}` : "- Not answered.",
  );
  const acc = r.typedSchemaAccepts;
  out.push(
    `- Our strict schemas accept the real responses: tournaments ${acc.tournaments ?? "n/a"}, sets ${acc.sets ?? "n/a"}, standings ${acc.standings ?? "n/a"}`,
  );
  out.push(
    "",
    r.eventChosenByFlag
      ? "## Event chosen with --event (not checked against the Texas 16+ rules)"
      : `## One completed ${REGION_STATE} 16+ singles event`,
  );
  if (r.event) {
    const e = r.event;
    out.push(`- Event id ${e.id}`);
    if (e.sets) {
      const s = e.sets;
      out.push(
        `- Completed sets (state filter on): total ${s.completedTotal ?? "unknown"}; unfiltered total ${e.allSetsTotal ?? "unknown"}${s.completedTotal !== null && e.allSetsTotal !== null ? (s.completedTotal === e.allSetsTotal ? " (same: every set is completed)" : ` (differs by ${e.allSetsTotal - s.completedTotal}: on a finished event these sets are invisible to sync, possibly DQs; check them)`) : ""}`,
        `- Sets pages: ${s.firstPageSets} on page 1 (page size ${s.pageSize}), ${s.lastPageSets ?? "no separate"} on the last page of ${s.totalPages ?? "?"}; about ${s.objectsPerPage} objects per page`,
        `- Player.user.slug visible for ${s.userSlugVisible.visible} of ${s.userSlugVisible.players} players`,
        `- DQ signals across the first and last pages: displayScore says DQ ${s.dq.displayScoreDq}; a score of -1 ${s.dq.scoreMinusOne}; completedAt null ${s.dq.completedAtNull}; winnerId null ${s.dq.winnerIdNull}`,
      );
      for (const x of s.dq.examples)
        out.push(
          `  - example set ${x.id}: displayScore ${JSON.stringify(x.displayScore)}, winnerId ${JSON.stringify(x.winnerId)}`,
        );
      if (!s.dq.examples.length)
        out.push("  - No DQ-looking set on those pages; try another event with --event.");
    } else out.push("- Sets: failed (see Errors).");
    out.push(
      e.standings
        ? `- Standings: ${e.standings.onPage} on page 1 (page size ${e.standings.pageSize}); total ${e.standings.total ?? "unknown"}; about ${e.standings.objects} objects`
        : "- Standings: failed (see Errors).",
    );
  } else out.push(`- ${r.noEventReason ?? "Not answered."}`);
  return `${out.join("\n")}\n`;
}
