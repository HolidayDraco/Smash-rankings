import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { loadEnv, loadOptionalEnv, MissingEnvError } from "@sr/core";
import { createDb, ingestRuns, type Database } from "@sr/db";
import { createStartggClient, type StartggClient, type StartggClientOptions } from "@sr/startgg";
import { startJobMonitor, type JobMonitor } from "./sentry";

export const EXIT_OK = 0;
/** The job ran and failed (start.gg error, bad token, DB error). */
export const EXIT_JOB_FAILED = 1;
/** Bad flags or missing env vars: nothing ran. */
export const EXIT_USAGE = 2;

export type JobName = "discover" | "sync" | "backfill" | "rate";

export interface JobArgs {
  dryRun: boolean;
  timeBudgetMinutes: number;
  from?: Date;
  to?: Date;
  /** Sync only this start.gg event id (manual use). Ignores start_at and the done status. */
  event?: number;
  /** The rate job's "as of" date (default: now). */
  asOf?: Date;
}

export class UsageError extends Error {
  override name = "UsageError";
}

function parseDate(flag: string, value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new UsageError(`${flag} must be a date like 2026-01-31`);
  return date;
}

export function parseJobArgs(argv: string[]): JobArgs {
  // `pnpm job:x -- --dry-run` can forward a bare "--"; node would then treat the flags as positionals.
  const args = argv.filter((arg, i) => !(arg === "--" && i === 0));
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        "dry-run": { type: "boolean", default: false },
        "time-budget-minutes": { type: "string", default: "20" },
        from: { type: "string" },
        to: { type: "string" },
        event: { type: "string" },
        "as-of": { type: "string" },
      },
    }));
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const timeBudgetMinutes = Number(values["time-budget-minutes"]);
  if (!(timeBudgetMinutes > 0)) throw new UsageError("--time-budget-minutes must be positive");
  const from = parseDate("--from", values.from);
  const to = parseDate("--to", values.to);
  if (from && to && from >= to) throw new UsageError("--from must be earlier than --to");
  const event = values.event === undefined ? undefined : Number(values.event);
  if (event !== undefined && !(Number.isInteger(event) && event > 0)) {
    throw new UsageError("--event must be a start.gg event id (a positive whole number)");
  }
  const asOf = parseDate("--as-of", values["as-of"]);
  // --as-of is a manual diagnostic only: it always runs as a dry run, so it can
  // never rewrite the live leaderboard or the 7-day snapshot to a past week.
  const dryRun = values["dry-run"] || asOf !== undefined;
  return { dryRun, timeBudgetMinutes, from, to, event, asOf };
}

export interface Deadline {
  /** True once it is time to stop starting new work (a safety margin before the budget ends). */
  expired(): boolean;
}

export function createDeadline(budgetMinutes: number, now: () => number = Date.now): Deadline {
  const budgetMs = budgetMinutes * 60_000;
  const stopAt = now() + budgetMs - Math.min(60_000, budgetMs * 0.1);
  return { expired: () => now() >= stopAt };
}

/** Strip anything secret-looking from an error before it is stored or printed. */
export function redactError(error: unknown, secrets: readonly string[]): string {
  let text = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) if (secret) text = text.split(secret).join("[redacted]");
  text = text.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  text = text.replace(/\b[a-z]+:\/\/\S+/gi, "[url redacted]");
  return text.slice(0, 500);
}

interface BaseContext {
  args: JobArgs;
  /** Null in a dry run (the job must not need the database to preview). */
  db: Database | null;
  /** Read-only access (SELECTs only, by type): the real database in a run, or in a dry run when DATABASE_URL happens to be set. */
  readDb: Pick<Database, "select"> | null;
  deadline: Deadline;
  now: () => number;
  /** Running totals, so a failed run still records how far it got. */
  progress: { eventsTouched: number };
  /** Error text with the token and database URL scrubbed. Use this for any log line. */
  redact: (error: unknown) => string;
  /** Environment (tests pass their own) and the stdout writer. */
  env: Record<string, string | undefined>;
  out: (line: string) => void;
}

export interface JobContext extends BaseContext {
  client: StartggClient;
}

/** Context for jobs that only use the database (rate): no start.gg client or token. */
export interface DbJobContext extends BaseContext {
  readDb: Pick<Database, "select">;
}

export interface JobResult {
  eventsTouched: number;
  /** One line for humans, e.g. "12 events found, 7 qualify". */
  summary: string;
  /** True when the time budget ended the run early; recorded as status "partial". */
  partial?: boolean;
}

export interface RunJobDeps {
  env?: Record<string, string | undefined>;
  /** Test hooks (fake fetch, clock, sleep, logger). Never includes the token. */
  clientOptions?: Partial<Omit<StartggClientOptions, "token">>;
  now?: () => number;
  out?: (line: string) => void;
}

/**
 * Shared job wrapper for start.gg jobs. Dry run needs only STARTGG_TOKEN and
 * writes nothing (no ingest_runs row either); a real run also needs
 * DATABASE_URL. Returns the exit code.
 */
export function runJob(
  job: JobName,
  argv: string[],
  body: (ctx: JobContext) => Promise<JobResult>,
  deps: RunJobDeps = {},
): Promise<number> {
  return execute(job, argv, deps, true, (base, client) => {
    if (!client) throw new Error(`${job}: start.gg client missing`);
    return body({ ...base, client });
  });
}

/**
 * Wrapper for jobs that never call start.gg (rate). Needs only DATABASE_URL,
 * also in a dry run (which reads but never writes, and logs no ingest_runs row).
 */
export function runDbJob(
  job: JobName,
  argv: string[],
  body: (ctx: DbJobContext) => Promise<JobResult>,
  deps: Omit<RunJobDeps, "clientOptions"> = {},
): Promise<number> {
  return execute(job, argv, deps, false, ({ readDb, ...base }) => {
    if (!readDb) throw new Error(`${job}: database missing`);
    return body({ ...base, readDb });
  });
}

async function execute(
  job: JobName,
  argv: string[],
  deps: RunJobDeps,
  needsStartgg: boolean,
  body: (ctx: BaseContext, client: StartggClient | null) => Promise<JobResult>,
): Promise<number> {
  const out = deps.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = deps.now ?? Date.now;
  let args: JobArgs;
  let env: { STARTGG_TOKEN?: string; DATABASE_URL?: string };
  let monitor: JobMonitor;
  try {
    args = parseJobArgs(argv);
    if (needsStartgg && args.asOf) throw new UsageError("--as-of is only for the rate job");
    if (!needsStartgg) env = loadEnv(["DATABASE_URL"], deps.env);
    else if (args.dryRun) {
      env = {
        ...loadEnv(["STARTGG_TOKEN"], deps.env),
        ...loadOptionalEnv(["DATABASE_URL"], deps.env),
      };
    } else env = loadEnv(["STARTGG_TOKEN", "DATABASE_URL"], deps.env);
    // Error reports and cron check-ins; a no-op unless SENTRY_DSN is set.
    monitor = startJobMonitor(
      job,
      deps.env ?? process.env,
      [env.STARTGG_TOKEN ?? "", env.DATABASE_URL ?? ""],
      { dryRun: args.dryRun },
    );
  } catch (error) {
    if (error instanceof UsageError || error instanceof MissingEnvError) {
      process.stderr.write(`${job}: ${error.message}\n`);
      return EXIT_USAGE;
    }
    throw error;
  }
  const secrets = [env.STARTGG_TOKEN ?? "", env.DATABASE_URL ?? ""];
  // A dry run never requires the database, but uses it (read-only) when one is configured.
  const database = env.DATABASE_URL ? createDb(env.DATABASE_URL, { maxConnections: 2 }) : null;
  const client = env.STARTGG_TOKEN
    ? createStartggClient({ ...deps.clientOptions, token: env.STARTGG_TOKEN })
    : null;
  const requestsUsed = () => client?.requestsUsed ?? 0;
  let runId: number | null = null;
  const progress = { eventsTouched: 0 };
  try {
    if (database && !args.dryRun) {
      const [row] = await database.db
        .insert(ingestRuns)
        .values({ job, status: "running" })
        .returning({ id: ingestRuns.id });
      runId = row?.id ?? null;
    }
    const ctx: BaseContext = {
      args,
      db: args.dryRun ? null : (database?.db ?? null),
      readDb: database?.db ?? null,
      deadline: createDeadline(args.timeBudgetMinutes, now),
      now,
      progress,
      redact: (error) => redactError(error, secrets),
      env: deps.env ?? process.env,
      out,
    };
    const result = await body(ctx, client);
    const requests = client ? `; ${requestsUsed()} requests` : "";
    out(`${args.dryRun ? "[dry run] " : ""}${job}: ${result.summary}${requests}`);
    await finishRun(database?.db, runId, {
      status: result.partial ? "partial" : "success",
      requestsUsed: requestsUsed(),
      eventsTouched: result.eventsTouched,
    });
    await monitor.succeeded().catch(() => undefined);
    return EXIT_OK;
  } catch (error) {
    const message = redactError(error, secrets);
    process.stderr.write(`${job} failed: ${message}\n`);
    const usage = error instanceof UsageError;
    await finishRun(database?.db, runId, {
      status: "error",
      requestsUsed: requestsUsed(),
      eventsTouched: progress.eventsTouched,
      error: message,
    }).catch(() => undefined);
    await monitor.failed(error, message).catch(() => undefined);
    return usage ? EXIT_USAGE : EXIT_JOB_FAILED;
  } finally {
    await database?.close();
  }
}

async function finishRun(
  db: Database | undefined,
  runId: number | null,
  fields: {
    status: "partial" | "success" | "error";
    requestsUsed: number;
    eventsTouched: number;
    error?: string;
  },
): Promise<void> {
  if (!db || runId === null) return;
  await db
    .update(ingestRuns)
    .set({ ...fields, finishedAt: new Date() })
    .where(eq(ingestRuns.id, runId));
}

/** True when this file is the process entry point (so tests can import it without running). */
export function isMain(moduleUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(entry).href === moduleUrl;
}
