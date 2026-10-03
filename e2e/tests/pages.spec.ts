import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const routes = [
  { path: "/", title: "Smash Rankings", heading: "Smash Rankings" },
  { path: "/style-guide", title: "Style guide | Smash Rankings", heading: "Style guide" },
] as const;

async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual(
    [],
  );
}

for (const route of routes) {
  test.describe(route.path, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(route.path);
    });

    test("renders title, heading, and attribution", async ({ page }) => {
      await expect(page).toHaveTitle(route.title);
      await expect(page.getByRole("heading", { level: 1, name: route.heading })).toBeVisible();
      const attribution = page.getByRole("link", { name: /Data from start\.gg/ });
      await expect(attribution).toBeVisible();
      await expect(attribution).toHaveAttribute("href", "https://www.start.gg/");
    });

    test("has no horizontal overflow", async ({ page }) => {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test("has no serious or critical axe violations", async ({ page }) => {
      await expectNoSeriousViolations(page);
    });
  });
}

test("home links to the style guide", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/unofficial fan project/i)).toBeVisible();
  await page.getByRole("link", { name: "Open the style guide" }).click();
  await expect(page).toHaveURL(/\/style-guide$/);
});

test("style guide shows every required section", async ({ page }) => {
  await page.goto("/style-guide");
  for (const name of ["Display type", "Color", "Angled panel", "Dense stat row", "Motion"]) {
    await expect(page.getByRole("heading", { name })).toBeVisible();
  }
  await expect(page.getByRole("listitem", { name: /Rank 1, Zorblax/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay motion sample" })).toBeVisible();
});

test("keyboard focus is visible on interactive elements", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(
    () => getComputedStyle(document.activeElement as Element).outlineStyle,
  );
  expect(outline).not.toBe("none");
});

test("touch targets are at least 44px", async ({ page }) => {
  await page.goto("/style-guide");
  const targets = page.getByRole("link").or(page.getByRole("button"));
  for (const box of await Promise.all((await targets.all()).map((t) => t.boundingBox()))) {
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
  }
});
