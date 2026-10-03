import { loadEnv } from "@sr/core";
import { createDb } from "./client";
import { runMigrations } from "./migrate";

const { DATABASE_URL } = loadEnv(["DATABASE_URL"]);
const { db, close } = createDb(DATABASE_URL, { maxConnections: 1 });
try {
  await runMigrations(db);
  console.log("Migrations applied.");
} finally {
  await close();
}
