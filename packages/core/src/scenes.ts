import { z } from "zod";

const isoDate = z.iso.date();

export const sceneIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id must be a lowercase slug like fort-worth");

/** A numbered rank, or "HM" (honorable mention, listed after the numbered ranks). */
export const HONORABLE_MENTION = "HM";

export const scenePlayerSchema = z.object({
  rank: z.union([z.number().int().positive(), z.literal(HONORABLE_MENTION)]),
  /** Kept exactly as published (sponsor tags, alternate tags); only checked to be non-blank. */
  name: z.string().refine((value) => value.trim().length > 0, "player name must not be empty"),
});

/** "official" is a panel-voted power ranking; "calculated" is formula-based (Braacket). */
export const sceneTypeSchema = z.enum(["official", "calculated"]);

export const sceneSchema = z
  .object({
    id: sceneIdSchema,
    city: z.string().trim().min(1),
    rankingName: z.string().trim().min(1),
    season: z.string().trim().min(1),
    /** https only, or null when the organizers posted no link. */
    sourceUrl: z
      .url()
      .refine((value) => value.startsWith("https://"), "sourceUrl must start with https://")
      .nullable(),
    type: sceneTypeSchema,
    /** Optional: when this city's list was published or copied. Never guessed. */
    updated: isoDate.optional(),
    players: z.array(scenePlayerSchema),
  })
  .superRefine((scene, ctx) => {
    let expected = 1;
    let seenHonorableMention = false;
    scene.players.forEach((player, index) => {
      if (player.rank === HONORABLE_MENTION) {
        seenHonorableMention = true;
        return;
      }
      if (seenHonorableMention) {
        ctx.addIssue({
          code: "custom",
          path: ["players", index, "rank"],
          message: "numbered ranks must come before any HM entries",
        });
      } else if (player.rank !== expected) {
        ctx.addIssue({
          code: "custom",
          path: ["players", index, "rank"],
          message: `ranks must be 1..N in order; expected ${expected} but found ${player.rank}`,
        });
      }
      expected += 1;
    });
  });

export const scenesFileSchema = z
  .object({
    version: z.literal(1),
    updated: isoDate,
    scenes: z.array(sceneSchema),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.scenes.forEach((scene, index) => {
      if (seen.has(scene.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["scenes", index, "id"],
          message: `duplicate scene id "${scene.id}"`,
        });
      }
      seen.add(scene.id);
    });
  });

export type ScenePlayer = z.infer<typeof scenePlayerSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type ScenesFile = z.infer<typeof scenesFileSchema>;
