import { z } from "zod";

/** How often (at most) the app asks the server which build is live. */
export const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** The id baked into this bundle at build time. Must stay a literal `process.env.EXPO_PUBLIC_...` read. */
export const embeddedBuildId = (): string | undefined =>
  process.env.EXPO_PUBLIC_BUILD_ID || undefined;

/** True when the server reports a build id that differs from the one we are running. Unknown ids never count. */
export function isNewVersion(embedded: string | undefined, remote: unknown): boolean {
  return Boolean(embedded) && typeof remote === "string" && remote !== "" && remote !== embedded;
}

/** Whether enough time has passed since the last check (or there has been none). */
export function shouldCheckVersion(
  lastCheckedAt: number | null,
  now: number,
  intervalMs: number = VERSION_CHECK_INTERVAL_MS,
): boolean {
  return lastCheckedAt === null || now - lastCheckedAt >= intervalMs;
}

/** Pulls the id out of a parsed build-id.json body; undefined when the shape is wrong. */
const buildIdBodySchema = z.object({ buildId: z.string().min(1) });

export function parseBuildId(body: unknown): string | undefined {
  const result = buildIdBodySchema.safeParse(body);
  return result.success ? result.data.buildId : undefined;
}

export const REFRESH_LABEL = "Refresh";
export const REFRESH_LABEL_NEW_VERSION = "Refresh, new version available";
