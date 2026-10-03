import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/*
 * Driver choice: postgres.js ("postgres"), not @neondatabase/serverless.
 * postgres.js speaks the normal Postgres wire protocol over TCP, so the same
 * code runs against Neon in production (its pooled connection string) and a
 * plain local or CI Postgres in tests. The Neon serverless driver talks over
 * HTTP/WebSockets and needs an extra proxy in front of a vanilla Postgres.
 *
 * `prepare: false` because Neon's pooler (PgBouncer, transaction mode) does
 * not support named prepared statements.
 */
export function createDb(databaseUrl: string, options: { maxConnections?: number } = {}) {
  const client = postgres(databaseUrl, {
    prepare: false,
    max: options.maxConnections ?? 5,
    onnotice: () => {},
  });
  const db = drizzle({ client, schema });
  return { db, close: () => client.end() };
}

export type Database = ReturnType<typeof createDb>["db"];
