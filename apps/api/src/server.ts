import { createDb } from "@sr/db";
import { createApp } from "./app";
import { loadApiConfig } from "./config";
import { initApiSentry } from "./sentry";

// Fails the cold start loudly (by variable name) if DATABASE_URL is missing.
const config = loadApiConfig();
// Off (a no-op) unless SENTRY_DSN is set. The database URL is scrubbed from every report.
const reportError = initApiSentry(process.env, [config.databaseUrl]);

let connection: ReturnType<typeof createDb> | undefined;

/** The production app: one lazily created DB pool per function instance. */
export const app = createApp({
  getDb: () => (connection ??= createDb(config.databaseUrl, { maxConnections: 3 })).db,
  allowedOrigins: config.allowedOrigins,
  allowedOriginPattern: config.allowedOriginPattern,
  reportError,
});
