import * as Sentry from "@sentry/node";
import { createSentryScrubber, loadOptionalEnv, SENTRY_DATA_COLLECTION } from "@sr/core";
import { StartggAuthError } from "@sr/startgg";
import type { JobName } from "./harness";

type MonitorConfig = NonNullable<Parameters<typeof Sentry.captureCheckIn>[1]>;

export const STARTGG_AUTH_MESSAGE = "start.gg token rejected (expired?)";
const FLUSH_TIMEOUT_MS = 5000;

/**
 * Sentry cron monitors, matching .github/workflows/ingest.yml. Sentry raises "missed check-in" when a
 * run doesn't start within the margin, and "timeout" past maxRuntime (the workflow's timeout-minutes).
 * Extra Fri-Mon runs at odd hours are simply extra check-ins.
 */
export const CRON_MONITORS: Partial<Record<JobName, MonitorConfig>> = {
  sync: {
    schedule: { type: "crontab", value: "23 */2 * * *" },
    timezone: "UTC",
    // GitHub often starts scheduled runs late, and a sync can queue behind the nightly backfill.
    checkinMargin: 60,
    maxRuntime: 50,
    // One dropped GitHub run shouldn't page Clay; two in a row should.
    failureIssueThreshold: 2,
    recoveryThreshold: 1,
  },
  rate: {
    // Rate runs right after each successful sync, so it shares sync's schedule with a wider margin.
    schedule: { type: "crontab", value: "23 */2 * * *" },
    timezone: "UTC",
    checkinMargin: 115,
    maxRuntime: 20,
    failureIssueThreshold: 2,
    recoveryThreshold: 1,
  },
};

export interface JobMonitor {
  succeeded(): Promise<void>;
  /** `redacted` is the already scrubbed error text. */
  failed(error: unknown, redacted: string): Promise<void>;
}

const OFF: JobMonitor = { succeeded: async () => undefined, failed: async () => undefined };

/** SENTRY_CRONS: unset or "1" = all monitors, "0" = none, or a list like "sync" (free-plan quota). */
function monitoredJobs(value: string | undefined): (job: JobName) => boolean {
  if (!value || value === "1") return () => true;
  const names = value.split(",").map((name) => name.trim());
  return (job) => names.includes(job);
}

/** A copy of the error that carries only the scrubbed message (the stack frames are kept). */
function scrubbedError(error: unknown, message: string): Error {
  const copy = new Error(message);
  if (error instanceof Error) {
    copy.name = error.name;
    const frames = (error.stack ?? "").split("\n").filter((line) => /^\s+at /.test(line));
    copy.stack = [`${copy.name}: ${message}`, ...frames].join("\n");
  }
  return copy;
}

/**
 * Starts Sentry for one job run when SENTRY_DSN is set (otherwise a no-op), and opens its cron
 * check-in. Throws MissingEnvError (by name) if SENTRY_DSN is set but malformed.
 */
export function startJobMonitor(
  job: JobName,
  env: Record<string, string | undefined>,
  secrets: readonly string[],
): JobMonitor {
  const { SENTRY_DSN } = loadOptionalEnv(["SENTRY_DSN"], env);
  if (!SENTRY_DSN) return OFF;
  Sentry.initWithoutDefaultIntegrations({
    dsn: SENTRY_DSN,
    environment: env.GITHUB_ACTIONS === "true" ? "github-actions" : "local",
    // No personal data: SDK 11's replacement for `sendDefaultPii: false`, plus no hostname.
    dataCollection: SENTRY_DATA_COLLECTION,
    includeServerName: false,
    tracesSampleRate: 0,
    enableRuntimeChannelInjection: false,
    integrations: [Sentry.linkedErrorsIntegration(), Sentry.dedupeIntegration()],
    initialScope: { tags: { job } },
    ...createSentryScrubber(secrets),
  });
  const monitorConfig = monitoredJobs(env.SENTRY_CRONS)(job) ? CRON_MONITORS[job] : undefined;
  const checkInId = monitorConfig
    ? Sentry.captureCheckIn({ monitorSlug: job, status: "in_progress" }, monitorConfig)
    : undefined;

  const finish = async (status: "ok" | "error") => {
    if (checkInId) Sentry.captureCheckIn({ checkInId, monitorSlug: job, status });
    await Sentry.flush(FLUSH_TIMEOUT_MS);
  };
  return {
    succeeded: () => finish("ok"),
    failed: async (error, redacted) => {
      if (error instanceof StartggAuthError) {
        // Tokens expire yearly; this must be loud and easy to recognize.
        Sentry.captureException(scrubbedError(error, STARTGG_AUTH_MESSAGE), {
          level: "fatal",
          tags: { job },
          extra: { detail: redacted },
          fingerprint: ["startgg-auth"],
        });
      } else {
        Sentry.captureException(scrubbedError(error, redacted), { tags: { job } });
      }
      await finish("error");
    },
  };
}
