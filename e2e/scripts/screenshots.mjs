// Saves full-page PNG screenshots for the PR. Run after `pnpm --filter @sr/app build:web`.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("../../docs/screenshots/p0-7/", import.meta.url));
mkdirSync(out, { recursive: true });
const port = "4174";
const server = spawn("node", [fileURLToPath(new URL("./serve.mjs", import.meta.url))], {
  env: { ...process.env, E2E_PORT: port },
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 1000));
const browser = await chromium.launch();
try {
  for (const [name, path] of [
    ["home", "/"],
    ["style-guide", "/style-guide"],
  ]) {
    for (const [width, height] of [
      [390, 844],
      [1280, 800],
    ]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto(`http://localhost:${port}${path}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      // The app scrolls inside a ScrollView, so grow the viewport to the full content height.
      const full = await page.evaluate(() =>
        Math.max(...[...document.querySelectorAll("*")].map((el) => el.scrollHeight)),
      );
      await page.setViewportSize({ width, height: Math.max(height, full) + 80 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}${name}-${width}.png`, fullPage: false });
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}
