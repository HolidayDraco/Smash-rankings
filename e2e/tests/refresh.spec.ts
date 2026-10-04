import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("the Refresh button sits in the header with a 44 px target", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("banner").getByRole("button", { name: "Refresh", exact: true });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  // Top right: in the right half of the header.
  const header = await page.getByRole("banner").boundingBox();
  expect(box!.x + box!.width).toBeGreaterThan(header!.x + header!.width - 40);
  expect(box!.y).toBeLessThan(header!.y + header!.height);
  // Nothing sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the button is on every page and has no serious axe problems", async ({ page }) => {
  for (const path of ["/", "/texas", "/leaderboard", "/status"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
  }
  const results = await new AxeBuilder({ page }).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad).toEqual([]);
});

test("the button shows a focus ring from the keyboard", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: "Refresh", exact: true });
  await button.focus();
  await expect(button).toHaveCSS("outline-style", "solid");
});

test("pressing it reloads the page", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    (window as unknown as { __marker: boolean }).__marker = true;
  });
  const loaded = page.waitForEvent("load");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await loaded;
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
  expect(await page.evaluate(() => "__marker" in window)).toBe(false);
});

test("a changed build id shows the dot and the new label", async ({ page }) => {
  await page.route("**/build-id.json", (route) =>
    route.fulfill({ json: { buildId: "some-other-build" } }),
  );
  await page.goto("/");
  const button = page.getByRole("button", { name: "Refresh, new version available" });
  await expect(button).toBeVisible();
  await expect(page.getByTestId("refresh-dot")).toBeVisible();
});

test("a matching build id shows no dot", async ({ page, request, baseURL }) => {
  const live = (await (await request.get(`${baseURL}/build-id.json`)).json()) as {
    buildId: string;
  };
  expect(live.buildId).toBeTruthy();
  let asked = false;
  await page.route("**/build-id.json", (route) => {
    asked = true;
    return route.fulfill({ json: live });
  });
  await page.goto("/");
  await expect.poll(() => asked).toBe(true);
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
  await expect(page.getByTestId("refresh-dot")).toHaveCount(0);
});

test("a failing build-id request is silent", async ({ page }) => {
  await page.route("**/build-id.json", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
  await expect(page.getByTestId("refresh-dot")).toHaveCount(0);
});
