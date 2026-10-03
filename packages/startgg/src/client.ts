import { print, type DocumentNode } from "graphql";
import type { z } from "zod";
import { STARTGG_MAX_REQUESTS_PER_MINUTE, ULTIMATE_VIDEOGAME_ID } from "@sr/core";
import {
  EventSetsPageDocument,
  EventStandingsPageDocument,
  TournamentsPageDocument,
} from "./generated/graphql";
import { TokenBucket, type Clock, type Sleep } from "./limiter";
import { normalizeSet, type NormalizedSet } from "./normalize";
import {
  setsDataSchema,
  standingsDataSchema,
  tournamentsDataSchema,
  type StandingNode,
  type TournamentNode,
} from "./schemas";

export const STARTGG_ENDPOINT = "https://api.start.gg/gql/alpha";

export type LogEntry = Record<string, unknown>;
export type Logger = (entry: LogEntry) => void;
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class StartggError extends Error {
  override name = "StartggError";
}
export class StartggAuthError extends StartggError {
  override name = "StartggAuthError";
}
export class StartggComplexityError extends StartggError {
  override name = "StartggComplexityError";
}
export class StartggSchemaError extends StartggError {
  override name = "StartggSchemaError";
}
class TransientError extends StartggError {}

export interface StartggClientOptions {
  token: string;
  fetch?: FetchLike;
  clock?: Clock;
  sleep?: Sleep;
  logger?: Logger;
  random?: () => number;
  maxRequestsPerMinute?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface Cursor {
  page: number;
  perPage: number;
}
export interface PageResult<T> {
  items: T[];
  page: number;
  perPage: number;
  totalPages: number;
  /** Save this as the checkpoint (events.sync_cursor); null when finished. */
  nextCursor: Cursor | null;
}
export interface PageOptions {
  perPage?: number;
  /** Resume point from a previous run's nextCursor. Its perPage wins over `perPage`. */
  cursor?: Cursor;
}
export interface TournamentWindow extends PageOptions {
  /** Epoch seconds. */
  afterDate: number;
  beforeDate: number;
  videogameId?: number;
}

/** About 14 objects per set (set, slots, entrants, players, scores), so 40 sets is ~560 of 1,000. */
export const DEFAULT_SETS_PER_PAGE = 40;
export const DEFAULT_STANDINGS_PER_PAGE = 100;
export const DEFAULT_TOURNAMENTS_PER_PAGE = 20;

export function createStartggClient(options: StartggClientOptions) {
  const {
    token,
    fetch: fetchImpl = fetch,
    clock = Date.now,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    logger = (entry) => process.stderr.write(`${JSON.stringify(entry)}\n`),
    random = Math.random,
    maxAttempts = 6,
    baseBackoffMs = 1_000,
    maxBackoffMs = 60_000,
  } = options;
  const limiter = new TokenBucket({
    ratePerMinute: Math.min(
      options.maxRequestsPerMinute ?? STARTGG_MAX_REQUESTS_PER_MINUTE,
      STARTGG_MAX_REQUESTS_PER_MINUTE,
    ),
    clock,
    sleep,
  });
  let requestsUsed = 0;

  const redact = (text: string) => text.split(token).join("[redacted]");
  const log = (entry: LogEntry) => logger(JSON.parse(redact(JSON.stringify(entry))) as LogEntry);

  async function request<TData>(
    queryName: string,
    document: DocumentNode,
    variables: Record<string, unknown>,
    schema: z.ZodType<TData>,
  ): Promise<TData> {
    const body = JSON.stringify({ query: print(document), variables });
    const page = variables["page"];
    const perPage = variables["perPage"];
    for (let attempt = 1; ; attempt++) {
      await limiter.acquire();
      requestsUsed++;
      const startedAt = clock();
      try {
        const data = await send(body);
        log({
          event: "startgg.request",
          queryName,
          page,
          perPage,
          attempt,
          durationMs: clock() - startedAt,
          outcome: "ok",
        });
        const parsed = schema.safeParse(data);
        if (!parsed.success) {
          throw new StartggSchemaError(
            `${queryName}: unexpected response shape: ${parsed.error.message}`,
          );
        }
        return parsed.data;
      } catch (error) {
        const retryable = error instanceof TransientError;
        const message = redact(error instanceof Error ? error.message : String(error));
        log({
          event: "startgg.request.failed",
          queryName,
          page,
          perPage,
          attempt,
          durationMs: clock() - startedAt,
          retryable,
          error: message,
        });
        if (!retryable || attempt >= maxAttempts) throw error;
        const ceiling = Math.min(maxBackoffMs, baseBackoffMs * 2 ** (attempt - 1));
        await sleep(Math.round(ceiling * (0.5 + 0.5 * random())));
      }
    }
  }

  /** One HTTP round trip. Throws TransientError for things worth retrying. */
  async function send(body: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(STARTGG_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body,
      });
    } catch (error) {
      throw new TransientError(
        `network error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const text = await response.text();
    let json: { data?: unknown; errors?: { message?: string }[]; message?: string } = {};
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      // Non-JSON body (e.g. a gateway error page); classified by status below.
    }
    const messages = [json.message, ...(json.errors ?? []).map((e) => e.message)].filter(
      (m): m is string => typeof m === "string",
    );
    const joined = messages.join("; ");
    if (
      response.status === 401 ||
      response.status === 403 ||
      /invalid authentication token/i.test(joined)
    ) {
      throw new StartggAuthError(
        `start.gg rejected the token (HTTP ${response.status}); it may have expired`,
      );
    }
    if (response.status === 429 || /rate limit exceeded/i.test(joined)) {
      throw new TransientError(`rate limited: ${joined || "HTTP 429"}`);
    }
    if (/complexity/i.test(joined)) throw new StartggComplexityError(joined);
    if (response.status >= 500) throw new TransientError(`HTTP ${response.status}`);
    if (!response.ok || json.errors?.length) {
      throw new StartggError(`HTTP ${response.status}: ${joined || "request failed"}`);
    }
    return json.data;
  }

  /** Walk every page. On a complexity error the page size is halved and the same items re-fetched. */
  async function* paginate<TData, TNode, TItem>(
    queryName: string,
    document: DocumentNode,
    schema: z.ZodType<TData>,
    variables: Record<string, unknown>,
    defaultPerPage: number,
    pageOptions: PageOptions,
    select: (data: TData) => { totalPages: number | null; nodes: (TNode | null)[] } | null,
    toItem: (node: TNode) => TItem | null,
    keyOf: (node: TNode) => number,
  ): AsyncGenerator<PageResult<TItem>> {
    let perPage = pageOptions.cursor?.perPage ?? pageOptions.perPage ?? defaultPerPage;
    let page = pageOptions.cursor?.page ?? 1;
    let itemsDone = (page - 1) * perPage;
    const seen = new Set<number>();
    for (;;) {
      let data: TData;
      try {
        data = await request(queryName, document, { ...variables, page, perPage }, schema);
      } catch (error) {
        if (!(error instanceof StartggComplexityError) || perPage <= 1) throw error;
        perPage = Math.max(1, Math.floor(perPage / 2));
        page = Math.floor(itemsDone / perPage) + 1;
        log({ event: "startgg.page_size_reduced", queryName, page, perPage });
        continue;
      }
      const connection = select(data);
      if (!connection) throw new StartggError(`${queryName}: not found (null result)`);
      const nodes = connection.nodes.filter((n): n is TNode => n !== null);
      const fresh = nodes.filter((n) => !seen.has(keyOf(n)));
      for (const n of fresh) seen.add(keyOf(n));
      const totalPages = connection.totalPages ?? (nodes.length < perPage ? page : page + 1);
      const nextCursor = page < totalPages ? { page: page + 1, perPage } : null;
      log({ event: "startgg.page", queryName, page, perPage, objects: nodes.length, totalPages });
      yield {
        items: fresh.map(toItem).filter((i): i is TItem => i !== null),
        page,
        perPage,
        totalPages,
        nextCursor,
      };
      if (!nextCursor) return;
      itemsDone = page * perPage;
      page += 1;
    }
  }

  return {
    get requestsUsed() {
      return requestsUsed;
    },

    /** Tournaments with Ultimate events in a date window (singles filtering is the caller's job; see isSinglesEvent). */
    tournamentsPages(window: TournamentWindow) {
      return paginate(
        "TournamentsPage",
        TournamentsPageDocument,
        tournamentsDataSchema,
        {
          videogameIds: [window.videogameId ?? ULTIMATE_VIDEOGAME_ID],
          afterDate: window.afterDate,
          beforeDate: window.beforeDate,
        },
        DEFAULT_TOURNAMENTS_PER_PAGE,
        window,
        (d) =>
          d.tournaments
            ? { totalPages: d.tournaments.pageInfo?.totalPages ?? null, nodes: d.tournaments.nodes }
            : null,
        (t: TournamentNode) => t,
        (t) => t.id,
      );
    },

    /** Completed sets of one event, normalized. Unusable sets (byes, doubles) are dropped. */
    eventSetsPages(eventId: number, pageOptions: PageOptions = {}) {
      return paginate(
        "EventSetsPage",
        EventSetsPageDocument,
        setsDataSchema,
        { eventId },
        DEFAULT_SETS_PER_PAGE,
        pageOptions,
        (d) =>
          d.event?.sets
            ? { totalPages: d.event.sets.pageInfo?.totalPages ?? null, nodes: d.event.sets.nodes }
            : null,
        (s): NormalizedSet | null => normalizeSet(s, eventId),
        (s) => s.id,
      );
    },

    /** Final placements of one event. */
    eventStandingsPages(eventId: number, pageOptions: PageOptions = {}) {
      return paginate(
        "EventStandingsPage",
        EventStandingsPageDocument,
        standingsDataSchema,
        { eventId },
        DEFAULT_STANDINGS_PER_PAGE,
        pageOptions,
        (d) =>
          d.event?.standings
            ? {
                totalPages: d.event.standings.pageInfo?.totalPages ?? null,
                nodes: d.event.standings.nodes,
              }
            : null,
        (s: StandingNode) => {
          const playerId =
            s.entrant?.participants?.length === 1
              ? s.entrant.participants[0]?.player?.id
              : undefined;
          return s.placement !== null && playerId !== undefined
            ? { placement: s.placement, playerId, entrantId: s.entrant?.id ?? 0 }
            : null;
        },
        (s) => s.entrant?.id ?? -1,
      );
    },
  };
}

export type StartggClient = ReturnType<typeof createStartggClient>;
