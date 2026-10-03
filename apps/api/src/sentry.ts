import * as Sentry from "@sentry/node";
import { createSentryScrubber, loadOptionalEnv, SENTRY_DATA_COLLECTION } from "@sr/core";

/** How long a 5xx response may wait for its error report to leave (Vercel freezes the function after). */
const FLUSH_TIMEOUT_MS = 2000;

/** Sends an unexpected error to Sentry. Undefined when Sentry is off. */
export type ReportError = (error: unknown) => Promise<void>;

/**
 * Turn Sentry on when SENTRY_DSN is set; otherwise do nothing (no network, no logs).
 * `secrets` are exact values (like DATABASE_URL) the scrubber removes from every report.
 */
export function initApiSentry(
  source: Record<string, string | undefined>,
  secrets: readonly string[],
  /** Tests pass a fake transport so nothing goes over the network. */
  overrides: Pick<Sentry.NodeOptions, "transport"> = {},
): ReportError | undefined {
  const { SENTRY_DSN } = loadOptionalEnv(["SENTRY_DSN"], source);
  if (!SENTRY_DSN) return undefined;
  Sentry.initWithoutDefaultIntegrations({
    dsn: SENTRY_DSN,
    environment: source.VERCEL_ENV ?? "development",
    // No personal data: SDK 11's replacement for `sendDefaultPii: false`, plus no hostname.
    dataCollection: SENTRY_DATA_COLLECTION,
    includeServerName: false,
    // Errors only: tracing would use up the free plan and isn't needed.
    tracesSampleRate: 0,
    // Module hooks only feed tracing, and they log a warning inside our esbuild bundle.
    enableRuntimeChannelInjection: false,
    integrations: [Sentry.linkedErrorsIntegration(), Sentry.dedupeIntegration()],
    ...createSentryScrubber(secrets),
    ...overrides,
  });
  return async (error) => {
    Sentry.captureException(error);
    await Sentry.flush(FLUSH_TIMEOUT_MS);
  };
}
