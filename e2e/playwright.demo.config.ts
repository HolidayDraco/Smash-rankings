import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * Demo-mode run: the app built with NO EXPO_PUBLIC_API_URL (see `pnpm e2e:demo`), served on its own
 * port, with NO API server and no database. Only the specs in ./demo run here.
 */
const PORT = Number(process.env.E2E_DEMO_PORT ?? 4521);

export default defineConfig({
  ...base,
  testDir: "./demo",
  use: { ...base.use, baseURL: `http://localhost:${PORT}` },
  webServer: [
    {
      command: "node scripts/serve.mjs",
      url: `http://localhost:${PORT}/`,
      reuseExistingServer: !process.env.CI,
      env: { E2E_PORT: String(PORT), E2E_DIST: "dist-demo" },
    },
  ],
});
