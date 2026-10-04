/**
 * Regenerates src/demo/data.json: the bundled sample data behind demo mode.
 *
 * It runs the real API in-process (no server) against a migrated and seeded throwaway database,
 * and saves the JSON answers as-is. Everything is synthetic ("Sample_*" players from the seed).
 *
 *   DATABASE_URL=postgres://... pnpm --filter @sr/db db:migrate && pnpm --filter @sr/db db:seed
 *   DATABASE_URL=postgres://... pnpm --filter @sr/app demo:snapshot
 *
 * Dates in the snapshot (this week, "last updated") are frozen at the moment it is generated.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// A build-time tool, not app code: it runs the real API in-process to record its answers.
// eslint-disable-next-line no-restricted-imports
import { createApp } from "@sr/api";
import { createDb, players } from "@sr/db";
import { demoDataSchema } from "../src/demo/schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set (use a migrated, seeded throwaway DB)");
if (/neon\.tech/i.test(databaseUrl)) throw new Error("Refusing to snapshot a Neon database");

const { db, close } = createDb(databaseUrl, { maxConnections: 1 });
try {
  const app = createApp({ getDb: () => db, allowedOrigins: [] });
  const get = async (path: string): Promise<unknown> => {
    const response = await app.request(path);
    if (response.status !== 200) throw new Error(`${path} answered ${response.status}`);
    return response.json();
  };

  // Merged aliases are skipped: the API answers them with a redirect to the main player.
  const rows = (
    await db
      .select({ id: players.id, gamerTag: players.gamerTag, mergedInto: players.mergedInto })
      .from(players)
  ).filter((row) => row.mergedInto === null);
  const synthetic = rows.filter((row) => row.gamerTag.startsWith("Sample_"));
  if (synthetic.length !== rows.length || rows.length === 0) {
    throw new Error("Database holds non-synthetic players; refusing to snapshot real data");
  }

  const playerById: Record<string, unknown> = {};
  for (const row of rows.sort((a, b) => a.id - b.id)) {
    playerById[String(row.id)] = await get(`/v1/players/${row.id}`);
  }

  const snapshot = demoDataSchema.parse({
    meta: await get("/v1/meta"),
    dashboard: await get("/v1/dashboard"),
    leaderboard: await get("/v1/leaderboard"),
    status: await get("/v1/status"),
    players: playerById,
  });
  const out = fileURLToPath(new URL("../src/demo/data.json", import.meta.url));
  writeFileSync(out, `${JSON.stringify(snapshot, null, 1)}\n`);
  console.log(`Wrote ${out} (${rows.length} players)`);
} finally {
  await close();
}
