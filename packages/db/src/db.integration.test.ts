import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "./client";
import { runMigrations } from "./migrate";
import {
  events,
  ingestRuns,
  leaderboard,
  meta,
  players,
  ratingHistory,
  sets,
  standings,
  tournaments,
} from "./schema";
import { leaderboardRowSchema, metaRowSchema } from "./zod";

// Must point at a throwaway database: the test drops and recreates its schema.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

/** Postgres SQLSTATE of a failed query (drizzle wraps the driver error in `cause`). */
async function sqlState(query: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await query;
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
  return undefined;
}

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";

describe.skipIf(!testDatabaseUrl)(
  "database schema (skipped: TEST_DATABASE_URL is not set; CI always sets it)",
  () => {
    let db: Database;
    let close: () => Promise<void>;

    beforeAll(async () => {
      if (!testDatabaseUrl) return;
      if (/neon\.tech/i.test(testDatabaseUrl)) {
        throw new Error("TEST_DATABASE_URL must be a disposable database, not Neon.");
      }
      ({ db, close } = createDb(testDatabaseUrl, { maxConnections: 1 }));
      await db.execute(sql`drop schema if exists drizzle cascade`);
      await db.execute(sql`drop schema if exists public cascade`);
      await db.execute(sql`create schema public`);
      await runMigrations(db);
      await runMigrations(db); // re-running must be a no-op
    }, 30_000);

    afterAll(async () => {
      await close?.();
    });

    it("stores and reads a row in every core table", async () => {
      const bigStartggId = 2 ** 40; // larger than a Postgres integer
      await db.insert(tournaments).values({ id: bigStartggId, slug: "t/genesis", name: "Genesis" });
      await db.insert(events).values({
        id: 10,
        tournamentId: bigStartggId,
        slug: "t/genesis/e/singles",
        name: "Singles",
      });
      await db.insert(players).values([
        { id: 1, gamerTag: "Alpha", countryCode: "US" },
        { id: 2, gamerTag: "Beta", prefix: "TEAM" },
      ]);
      const completedAt = new Date("2026-02-01T18:30:00Z");
      await db.insert(sets).values({
        id: 100,
        eventId: 10,
        winnerId: 1,
        loserId: 2,
        winnerGames: 3,
        loserGames: 1,
        completedAt,
        ratingPeriod: 5,
      });
      await db.insert(standings).values({ eventId: 10, playerId: 1, placement: 1 });
      await db
        .insert(ratingHistory)
        .values({ playerId: 1, period: 5, rating: 1464.06, rd: 151.52, volatility: 0.05999 });
      await db.insert(leaderboard).values({
        playerId: 1,
        rank: 1,
        conservativeScore: 1160.02,
        rating: 1464.06,
        rd: 151.52,
        eligible: true,
      });
      const [run] = await db
        .insert(ingestRuns)
        .values({ job: "sync" })
        .returning({ id: ingestRuns.id });
      await db.insert(meta).values({ key: "data_version", value: "1" });

      expect((await db.select().from(tournaments))[0]?.id).toBe(bigStartggId);
      expect((await db.select().from(events))[0]?.syncStatus).toBe("pending");
      expect(await db.select().from(sets).where(eq(sets.winnerId, 1))).toEqual([
        expect.objectContaining({ id: 100, isDq: false, completedAt }),
      ]);
      expect((await db.select().from(standings))[0]?.placement).toBe(1);
      expect((await db.select().from(ratingHistory))[0]?.volatility).toBe(0.05999);
      expect(run?.id).toBeGreaterThan(0);
      const [runRow] = await db.select().from(ingestRuns);
      expect(runRow?.status).toBe("running");
      expect(runRow?.startedAt).toBeInstanceOf(Date);

      leaderboardRowSchema.parse((await db.select().from(leaderboard))[0]);
      metaRowSchema.parse((await db.select().from(meta))[0]);
    });

    it("enforces the keys and constraints the jobs rely on", async () => {
      // Unique slugs and composite primary keys make upserts idempotent.
      expect(
        await sqlState(db.insert(tournaments).values({ id: 2, slug: "t/genesis", name: "Dup" })),
      ).toBe(UNIQUE_VIOLATION);
      expect(
        await sqlState(db.insert(standings).values({ eventId: 10, playerId: 1, placement: 2 })),
      ).toBe(UNIQUE_VIOLATION);
      expect(
        await sqlState(
          db
            .insert(ratingHistory)
            .values({ playerId: 1, period: 5, rating: 1, rd: 1, volatility: 1 }),
        ),
      ).toBe(UNIQUE_VIOLATION);

      // Foreign keys.
      expect(
        await sqlState(
          db.insert(events).values({ id: 11, tournamentId: 999, slug: "x", name: "x" }),
        ),
      ).toBe(FOREIGN_KEY_VIOLATION);
      expect(
        await sqlState(db.insert(sets).values({ id: 101, eventId: 10, winnerId: 1, loserId: 999 })),
      ).toBe(FOREIGN_KEY_VIOLATION);
      expect(
        await sqlState(db.insert(players).values({ id: 3, gamerTag: "x", mergedInto: 999 })),
      ).toBe(FOREIGN_KEY_VIOLATION);

      // Check constraints on sets.
      expect(
        await sqlState(db.insert(sets).values({ id: 102, eventId: 10, winnerId: 1, loserId: 1 })),
      ).toBe(CHECK_VIOLATION);
      expect(
        await sqlState(
          db.insert(sets).values({ id: 103, eventId: 10, winnerId: 1, loserId: 2, loserGames: -1 }),
        ),
      ).toBe(CHECK_VIOLATION);

      // Alias merge: merged_into points at another existing player.
      await db.insert(players).values({ id: 4, gamerTag: "Alpha alt", mergedInto: 1 });
      expect((await db.select().from(players).where(eq(players.id, 4)))[0]?.mergedInto).toBe(1);
    });
  },
);
