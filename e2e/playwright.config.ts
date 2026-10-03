import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 4173);
const API_PORT = Number(process.env.API_PORT ?? 8787);

/**
 * Locally the browser is pre-installed under PLAYWRIGHT_BROWSERS_PATH. We always launch the newest
 * chromium-<revision> found there, whether or not it matches Playwright's expected revision.
 * In CI we use the browser that `playwright install` downloads.
 */
function localChromiumPath(): string | undefined {
  if (process.env.CI) return undefined;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  if (!existsSync(base)) return undefined;
  const dir = readdirSync(base)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1]))
    .pop();
  const exe = dir ? join(base, dir, "chrome-linux", "chrome") : "";
  return exe && existsSync(exe) ? exe : undefined;
}

const executablePath = localChromiumPath();

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: executablePath ? { executablePath } : {},
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mobile-390", use: { viewport: { width: 390, height: 844 }, isMobile: false } },
    { name: "desktop-1280", use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    {
      command: "node scripts/serve.mjs",
      url: `http://localhost:${PORT}/`,
      reuseExistingServer: !process.env.CI,
      env: { E2E_PORT: String(PORT) },
    },
    {
      // The API needs DATABASE_URL (a migrated, seeded throwaway database) in the environment.
      command: "pnpm --filter @sr/api exec tsx src/dev.ts",
      url: `http://localhost:${API_PORT}/`,
      reuseExistingServer: !process.env.CI,
      // The browser calls the API from the static server's origin, so CORS must allow it.
      env: { ALLOWED_ORIGINS: `http://localhost:${PORT}`, API_PORT: String(API_PORT) },
    },
  ],
});
