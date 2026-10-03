// Saves PR screenshots (leaderboard, search, loading skeleton) at 390 and 1280 px wide.
// Needs the API on :8787 against a seeded database, and `pnpm e2e`'s web build in apps/app/dist.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("../../docs/screenshots/p1-8/", import.meta.url));
mkdirSync(out, { recursive: true });
const port = "4173";
const server = spawn("node", [fileURLToPath(new URL("./serve.mjs", import.meta.url))], {
  env: { ...process.env, E2E_PORT: port },
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 1000));
const browser = await chromium.launch();

const scenes = {
  async leaderboard(page) {
    await page.goto(`http://localhost:${port}/`);
    await page.getByRole("list", { name: /leaderboard/ }).waitFor();
  },
  async search(page) {
    await page.goto(`http://localhost:${port}/`);
    await page.getByRole("searchbox").fill("sample_d");
    await page.getByRole("list", { name: /search results/ }).waitFor();
  },
  async loading(page) {
    await page.route("**/v1/leaderboard*", () => {}); // never answers: stays on the skeleton
    await page.goto(`http://localhost:${port}/`);
    await page.getByTestId("skeleton-row").first().waitFor();
  },
};

try {
  for (const [name, scene] of Object.entries(scenes)) {
    for (const [width, height] of [
      [390, 1100],
      [1280, 900],
    ]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await scene(page);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${out}${name}-${width}.png` });
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}
