import { createSelectSchema } from "drizzle-zod";
import type { z } from "zod";
import { leaderboard, meta } from "./schema";

/** Shape of a leaderboard row as it leaves packages/db. */
export const leaderboardRowSchema = createSelectSchema(leaderboard);
export type LeaderboardRow = z.infer<typeof leaderboardRowSchema>;

/** Shape of a meta row as it leaves packages/db. */
export const metaRowSchema = createSelectSchema(meta);
export type MetaRow = z.infer<typeof metaRowSchema>;
