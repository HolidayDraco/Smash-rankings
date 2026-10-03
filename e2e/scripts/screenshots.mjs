// Saves PR screenshots at 390 and 1280 px wide: `node screenshots.mjs` (P1-8 leaderboard scenes)
// or `node screenshots.mjs p1-9` (player page scenes).
// Needs the API on :8787 against a seeded database, and `pnpm e2e`'s web build in apps/app/dist.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const set = process.argv[2] ?? "p1-8";
const out = fileURLToPath(new URL(`../../docs/screenshots/${set}/`, import.meta.url));
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

const api = process.env.E2E_API_URL ?? "http://localhost:8787";
const firstId = async (url, pick) => pick(await (await fetch(url)).json());
const playerScenes = {
  async ranked(page) {
    const id = await firstId(`${api}/v1/leaderboard`, (b) => b.entries[0].playerId);
    await page.goto(`http://localhost:${port}/player/${id}-x`);
    await page.getByRole("list", { name: "Recent results" }).waitFor();
  },
  async unranked(page) {
    const id = await firstId(
      `${api}/v1/search?q=sample_`,
      (b) => b.results.find((p) => p.rank === null).playerId,
    );
    await page.goto(`http://localhost:${port}/player/${id}-x`);
    await page
      .getByRole("status")
      .filter({ hasText: /Needs|uncertain/ })
      .waitFor();
  },
  async notfound(page) {
    await page.goto(`http://localhost:${port}/player/999999999-ghost`);
    await page.getByRole("heading", { name: "Player not found" }).waitFor();
  },
};

try {
  for (const [name, scene] of Object.entries(set === "p1-9" ? playerScenes : scenes)) {
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
