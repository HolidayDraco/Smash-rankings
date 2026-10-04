import {
  dashboardResponseSchema,
  leaderboardResponseSchema,
  metaResponseSchema,
  playerResponseSchema,
  statusResponseSchema,
} from "@sr/core";
import { z } from "zod";

/** Shape of src/demo/data.json: one saved answer per API endpoint, checked by the real schemas. */
export const demoDataSchema = z.strictObject({
  meta: metaResponseSchema,
  dashboard: dashboardResponseSchema,
  leaderboard: leaderboardResponseSchema,
  status: statusResponseSchema,
  /** Keyed by player id, one entry for every seeded player. */
  players: z.record(z.string().regex(/^\d+$/), playerResponseSchema),
});
export type DemoData = z.infer<typeof demoDataSchema>;
