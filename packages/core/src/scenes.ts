import { z } from "zod";

const isoDate = z.iso.date();

export const sceneIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id must be a lowercase slug like fort-worth");

/** A numbered rank, or "HM" (honorable mention, listed after the numbered ranks). */
export const HONORABLE_MENTION = "HM";

export const scenePlayerSchema = z.strictObject({
  rank: z.union([z.number().int().positive(), z.literal(HONORABLE_MENTION)]),
  /** Kept exactly as published (sponsor tags, alternate tags); only checked to be non-blank. */
  name: z.string().refine((value) => value.trim().length > 0, "player name must not be empty"),
});

/** "official" is a panel-voted power ranking; "calculated" is formula-based (Braacket). */
export const sceneTypeSchema = z.enum(["official", "calculated"]);

/** Wiki hosts whose content is CC BY-SA: an entry sourced from one must carry `credit`. */
export const CC_BY_SA_WIKI_HOSTS = ["liquipedia.net", "ssbwiki.com"] as const;

function isCcBySaWikiUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false; // not a URL at all; the sourceUrl check reports that
  }
  return CC_BY_SA_WIKI_HOSTS.some((wiki) => host === wiki || host.endsWith(`.${wiki}`));
}

/** Attribution for entries copied from a CC BY-SA wiki. */
export const sceneCreditSchema = z.strictObject({
  site: z.string().trim().min(1),
  license: z.literal("CC BY-SA"),
  /**
   * The Creative Commons license page for the exact version (e.g. by-sa/3.0). Optional until the
   * version is confirmed from the source site's footer; must be a creativecommons.org https link.
   */
  licenseUrl: z
    .url()
    .refine(
      (value) => value.startsWith("https://creativecommons.org/licenses/by-sa/"),
      "licenseUrl must be a https://creativecommons.org/licenses/by-sa/... link",
    )
    .optional(),
});

export const sceneSchema = z
  .strictObject({
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
    /** Required when sourceUrl is a CC BY-SA wiki (Liquipedia, SmashWiki). */
    credit: sceneCreditSchema.optional(),
    players: z.array(scenePlayerSchema),
  })
  .superRefine((scene, ctx) => {
    if (scene.sourceUrl && isCcBySaWikiUrl(scene.sourceUrl) && !scene.credit) {
      ctx.addIssue({
        code: "custom",
        path: ["credit"],
        message: "entries sourced from Liquipedia or SmashWiki (CC BY-SA) must include credit",
      });
    }
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
  .strictObject({
    version: z.literal(1),
    updated: isoDate,
    scenes: z.array(sceneSchema),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    const seenCities = new Set<string>();
    file.scenes.forEach((scene, index) => {
      const cityKey = scene.city.trim().toLowerCase();
      if (seenCities.has(cityKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["scenes", index, "city"],
          message: `duplicate city "${scene.city}"`,
        });
      }
      seenCities.add(cityKey);
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
export type SceneCredit = z.infer<typeof sceneCreditSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type ScenesFile = z.infer<typeof scenesFileSchema>;
