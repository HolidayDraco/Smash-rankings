import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ORDER = ["Austin", "Dallas-Fort Worth", "Houston", "Rio Grande Valley", "San Antonio"];

async function cityOrder(page: Page) {
  const list = page.getByRole("list", { name: "Texas cities" });
  const names = await list.getByRole("button", { name: / players$/ }).allTextContents();
  return names.map((text) => text.replace(/(Calculated ranking)?(View|Hide)$/, "").trim());
}

test.beforeEach(async ({ page }) => {
  await page.goto("/texas");
  await expect(page.getByRole("heading", { level: 1, name: "Texas" })).toBeVisible();
});

test("lists the five real scenes alphabetically, with no sample notice", async ({ page }) => {
  expect(await cityOrder(page)).toEqual(ORDER);
  await expect(page.getByText(/Sample data/)).toHaveCount(0);
  await expect(page.getByText("Rankings from local organizers")).toBeVisible();
  await expect(page.getByRole("link", { name: /Data from start\.gg/ })).toBeVisible();
  await expect(page.getByText("Calculated ranking", { exact: true })).toHaveCount(2);
});

test("search filters by city and shows an empty state", async ({ page }) => {
  const box = page.getByRole("searchbox", { name: "Search cities" });
  await box.fill("san");
  expect(await cityOrder(page)).toEqual(["San Antonio"]);
  await box.fill("zzz");
  await expect(page.getByText('No scenes match "zzz"')).toBeVisible();
  const status = page.getByRole("status");
  await expect(status).toHaveText('No scenes match "zzz"');
  await box.fill("");
  await expect(status).toHaveText("5 cities");
  await box.fill("san");
  await expect(status).toHaveText("1 city");
});

test("pinning moves a city to the top and survives a reload", async ({ page }) => {
  const pinned = ["Houston", "Austin", "Dallas-Fort Worth", "Rio Grande Valley", "San Antonio"];
  await page.getByRole("button", { name: "Pin Houston" }).click();
  await expect(page.getByRole("button", { name: "Unpin Houston" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await cityOrder(page)).toEqual(pinned);
  await page.reload();
  await expect(page.getByRole("button", { name: "Unpin Houston" })).toBeVisible();
  expect(await cityOrder(page)).toEqual(pinned);
  await page.getByRole("button", { name: "Unpin Houston" }).click();
  expect(await cityOrder(page)).toEqual(ORDER);
});

test("works when storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked");
      },
    });
  });
  await page.goto("/texas");
  await page.getByRole("button", { name: "Pin Austin" }).click();
  await expect(page.getByRole("button", { name: "Unpin Austin" })).toBeVisible();
});

test("expanding Dallas-Fort Worth shows its ranking, HM entries and source", async ({ page }) => {
  const header = page.getByRole("button", { name: /^Dallas-Fort Worth, 11 players$/ });
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("DFW Ultimate PR 2026 Q2")).toBeVisible();
  const items = page.getByRole("list", { name: "Dallas-Fort Worth ranking" }).getByRole("listitem");
  await expect(items).toHaveCount(11);
  await expect(items.first()).toContainText("1");
  await expect(items.first()).toContainText("Atomic");
  await expect(items.last()).toContainText("HM");
  await expect(items.last()).toContainText("Grapezard X");
  await expect(page.getByText("From Liquipedia · CC BY-SA")).toBeVisible();
  await expect(page.getByLabel("Honorable mention")).toHaveCount(1);
  // No separate License link until the license version is confirmed (it would repeat Source).
  await expect(page.getByRole("link", { name: /license for Dallas-Fort Worth/ })).toHaveCount(0);
  const source = page.getByRole("link", { name: /Source for Dallas-Fort Worth/ });
  await expect(source).toHaveAttribute("target", "_blank");
  await expect(source).toHaveAttribute("href", /^https:\/\//);
  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "false");
});

test("names are shown exactly as published and calculated scenes are labelled", async ({
  page,
}) => {
  await page.getByRole("button", { name: /^San Antonio, / }).click();
  await expect(page.getByText("gold_ship_ / nadia_ / Winds", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Rio Grande Valley, / }).click();
  await expect(page.getByText("Calculated ranking: worked out by a formula")).toBeVisible();
  await expect(page.getByText("Goblin Giant:) | flauTAS", { exact: true })).toBeVisible();
});

test("has no serious or critical axe violations, collapsed and expanded", async ({ page }) => {
  const check = async () => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual(
      [],
    );
  };
  await check();
  await page.getByRole("button", { name: /^Houston, / }).click();
  await page.getByRole("button", { name: "Pin Austin" }).click();
  await check();
});

test("has no horizontal overflow and 44px targets", async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  for (const target of await page
    .getByRole("list", { name: "Texas cities" })
    .getByRole("button")
    .all()) {
    const box = await target.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(43.5);
  }
});
