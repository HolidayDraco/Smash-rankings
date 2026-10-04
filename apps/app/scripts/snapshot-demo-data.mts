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
// Only a database on this machine: a hosted one could hold real start.gg data.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
if (!LOCAL_HOSTS.has(new URL(databaseUrl).hostname)) {
  throw new Error("Refusing to snapshot a non-local database (use a throwaway local one)");
}

const { db, close } = createDb(databaseUrl, { maxConnections: 1 });
try {
  const app = createApp({ getDb: () => db, allowedOrigins: [] });
  const get = async (path: string): Promise<unknown> => {
    const response = await app.request(path);
    if (response.status !== 200) throw new Error(`${path} answered ${response.status}`);
    return response.json();
  };

  // Every player, merged aliases included, must be synthetic before anything is recorded.
  const allRows = await db
    .select({ id: players.id, gamerTag: players.gamerTag, mergedInto: players.mergedInto })
    .from(players);
  if (allRows.length === 0 || !allRows.every((row) => row.gamerTag.startsWith("Sample_"))) {
    throw new Error("Database holds non-synthetic players; refusing to snapshot real data");
  }
  // Merged aliases are skipped: the API answers them with a redirect to the main player.
  const rows = allRows.filter((row) => row.mergedInto === null);

  const playerById: Record<string, unknown> = {};
  for (const row of rows.sort((a, b) => a.id - b.id)) {
    playerById[String(row.id)] = await get(`/v1/players/${row.id}`);
  }

  const parsed = demoDataSchema.parse({
    meta: await get("/v1/meta"),
    dashboard: await get("/v1/dashboard"),
    leaderboard: await get("/v1/leaderboard"),
    status: await get("/v1/status"),
    players: playerById,
  });
  const tournaments = [
    ...parsed.dashboard.weekEvents.map((event) => event.tournamentName),
    ...parsed.dashboard.upsets.map((upset) => upset.tournamentName),
    ...(parsed.dashboard.year.biggestEvent
      ? [parsed.dashboard.year.biggestEvent.tournamentName]
      : []),
  ];
  if (!tournaments.every((name) => name.startsWith("Sample "))) {
    throw new Error("Dashboard holds non-synthetic tournaments; refusing to snapshot real data");
  }
  // Sample players have no real start.gg profile, so the demo never links to one.
  const snapshot = demoDataSchema.parse({
    ...parsed,
    players: Object.fromEntries(
      Object.entries(parsed.players).map(([id, player]) => [id, { ...player, startggUrl: null }]),
    ),
  });
  const out = fileURLToPath(new URL("../src/demo/data.json", import.meta.url));
  writeFileSync(out, `${JSON.stringify(snapshot, null, 1)}\n`);
  console.log(`Wrote ${out} (${rows.length} players)`);
} finally {
  await close();
}
