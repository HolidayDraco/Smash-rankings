import { loadEnv } from "@sr/core";
import { createDb } from "./client";
import { seedSynthetic } from "./seed";

const { DATABASE_URL } = loadEnv(["DATABASE_URL"]);
// Guard against filling the production database with fake players by accident.
if (/neon\.tech/i.test(DATABASE_URL) && !process.argv.includes("--allow-neon")) {
  console.error("Refusing to seed a Neon database. Pass --allow-neon if you really mean it.");
  process.exit(1);
}
const { db, close } = createDb(DATABASE_URL, { maxConnections: 1 });
try {
  await seedSynthetic(db);
  console.log("Synthetic seed data written.");
} finally {
  await close();
}
