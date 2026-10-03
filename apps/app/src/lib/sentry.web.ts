/*
 * Web error reporting with @sentry/react. Metro picks this file on web; sentry.ts (a no-op) on
 * iOS/Android until the native apps get their own setup. Off unless EXPO_PUBLIC_SENTRY_DSN is set.
 */
import type * as SentryReact from "@sentry/react";
import { createSentryScrubber, SENTRY_DATA_COLLECTION } from "@sr/core";
import { z } from "zod";

type SentryModule = typeof SentryReact;

/**
 * Loaded only when a DSN is configured. `import()` makes Metro put the SDK in its own file, so
 * visitors never download it while Sentry is off (Metro can't tree-shake it: +1.2 MB otherwise).
 */
let sentry: Promise<SentryModule | undefined> | undefined;

/** Start Sentry once, in the browser only (never during the static build's server render). */
export function initSentry(): void {
  if (sentry || typeof window === "undefined") return;
  // Must stay a literal read: Expo inlines EXPO_PUBLIC_* values at build time. A DSN is public.
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn || !z.url().safeParse(dsn).success) return;
  sentry = import("@sentry/react")
    .then((Sentry) => {
      Sentry.init({
        dsn,
        environment: __DEV__ ? "development" : "production",
        // No personal data: SDK 11's replacement for `sendDefaultPii: false`.
        dataCollection: SENTRY_DATA_COLLECTION,
        // Errors only: no tracing, no replay, no per-visit session pings (free plan, privacy).
        integrations: (defaults) =>
          defaults.filter((integration) => integration.name !== "BrowserSession"),
        // The web app holds no secrets, so only the pattern rules apply.
        ...createSentryScrubber(),
      });
      return Sentry;
    })
    // A blocked or failed download must never break the site.
    .catch(() => undefined);
}

/** Report an error caught by the app's error boundary. Does nothing while Sentry is off. */
export function reportRenderError(error: unknown, componentStack?: string): void {
  void sentry?.then((Sentry) =>
    Sentry?.captureException(
      error,
      componentStack ? { contexts: { react: { componentStack } } } : {},
    ),
  );
}
