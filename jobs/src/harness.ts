import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { loadEnv, MissingEnvError } from "@sr/core";
import { createDb, ingestRuns, type Database } from "@sr/db";
import { createStartggClient, type StartggClient, type StartggClientOptions } from "@sr/startgg";

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
  return { dryRun: values["dry-run"], timeBudgetMinutes, from, to };
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

export interface JobContext {
  args: JobArgs;
  client: StartggClient;
  /** Null in a dry run (the job must not need the database to preview). */
  db: Database | null;
  deadline: Deadline;
  now: () => number;
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
 * Shared job wrapper. Dry run needs only STARTGG_TOKEN and writes nothing (no
 * ingest_runs row either); a real run also needs DATABASE_URL. Returns the exit code.
 */
export async function runJob(
  job: JobName,
  argv: string[],
  body: (ctx: JobContext) => Promise<JobResult>,
  deps: RunJobDeps = {},
): Promise<number> {
  const out = deps.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = deps.now ?? Date.now;
  let args: JobArgs;
  let env: { STARTGG_TOKEN: string; DATABASE_URL?: string };
  try {
    args = parseJobArgs(argv);
    env = args.dryRun
      ? loadEnv(["STARTGG_TOKEN"], deps.env)
      : loadEnv(["STARTGG_TOKEN", "DATABASE_URL"], deps.env);
  } catch (error) {
    if (error instanceof UsageError || error instanceof MissingEnvError) {
      process.stderr.write(`${job}: ${error.message}\n`);
      return EXIT_USAGE;
    }
    throw error;
  }
  const secrets = [env.STARTGG_TOKEN, env.DATABASE_URL ?? ""];
  const database = env.DATABASE_URL ? createDb(env.DATABASE_URL, { maxConnections: 2 }) : null;
  const client = createStartggClient({
    ...deps.clientOptions,
    token: env.STARTGG_TOKEN,
  });
  let runId: number | null = null;
  try {
    if (database) {
      const [row] = await database.db
        .insert(ingestRuns)
        .values({ job, status: "running" })
        .returning({ id: ingestRuns.id });
      runId = row?.id ?? null;
    }
    const ctx: JobContext = {
      args,
      client,
      db: database?.db ?? null,
      deadline: createDeadline(args.timeBudgetMinutes, now),
      now,
    };
    const result = await body(ctx);
    out(
      `${args.dryRun ? "[dry run] " : ""}${job}: ${result.summary}; ${client.requestsUsed} requests`,
    );
    await finishRun(database?.db, runId, {
      status: result.partial ? "partial" : "success",
      requestsUsed: client.requestsUsed,
      eventsTouched: result.eventsTouched,
    });
    return EXIT_OK;
  } catch (error) {
    const message = redactError(error, secrets);
    process.stderr.write(`${job} failed: ${message}\n`);
    await finishRun(database?.db, runId, {
      status: "error",
      requestsUsed: client.requestsUsed,
      eventsTouched: 0,
      error: message,
    }).catch(() => undefined);
    return EXIT_JOB_FAILED;
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
