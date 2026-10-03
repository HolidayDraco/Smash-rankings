import { createDb } from "@sr/db";
import { createApp } from "./app";
import { loadApiConfig } from "./config";

// Fails the cold start loudly (by variable name) if DATABASE_URL is missing.
const config = loadApiConfig();

let connection: ReturnType<typeof createDb> | undefined;

/** The production app: one lazily created DB pool per function instance. */
export const app = createApp({
  getDb: () => (connection ??= createDb(config.databaseUrl, { maxConnections: 3 })).db,
  allowedOrigins: config.allowedOrigins,
});
