import { scenesFileSchema, type ScenesFile } from "./scenes";
import rawTexasScenes from "../../../data/scenes/texas.json";

/**
 * The hand-edited Texas scenes file, validated at import time. A bad edit throws here, so the
 * build (and every test that imports it) fails loudly instead of shipping broken data.
 * This is a tiny module in packages/core, exposed as `@sr/core/texas-scenes`, because it keeps the
 * repo-root JSON import in one place that Metro, Vitest and tsc all resolve through a normal
 * package export. It is not re-exported from `@sr/core` so API and jobs code never bundle it.
 */
export const texasScenes: ScenesFile = scenesFileSchema.parse(rawTexasScenes);
