import { loadEnv } from "@sr/core";
import { createDb } from "./client";
import { seedSynthetic } from "./seed";

const { DATABASE_URL } = loadEnv(["DATABASE_URL"]);
// Guard against filling the production database with fake players by accident.
const isNeon = /neon\.tech/i.test(DATABASE_URL);
if (isNeon && !process.argv.includes("--allow-neon")) {
  console.error("Refusing to seed a Neon database. Pass --allow-neon if you really mean it.");
  process.exit(1);
}
if (isNeon) {
  console.warn(
    "WARNING: seeding a Neon database. Synthetic rows will be added; existing meta values " +
      "(data_version, last_rated_at) are kept, not overwritten.",
  );
}
const { db, close } = createDb(DATABASE_URL, { maxConnections: 1 });
try {
  await seedSynthetic(db, { keepExistingMeta: isNeon });
  console.log("Synthetic seed data written.");
} finally {
  await close();
}
