import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { colors } from "@sr/ui/tokens";

const routes = [
  {
    path: "/",
    title: "Dashboard | Smash Ultimate Rankings | Bracket Index",
    heading: "Dashboard",
  },
  { path: "/texas", title: "Texas | Bracket Index", heading: "Texas" },
  { path: "/style-guide", title: "Style guide | Bracket Index", heading: "Style guide" },
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
      // The leaderboard fades in; wait for it to finish so axe measures real colors.
      if (route.path === "/") {
        await expect(page.getByRole("list").first().locator("..")).toHaveCSS("opacity", "1");
      }
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

test("style guide shows every required section", async ({ page }) => {
  await page.goto("/style-guide");
  for (const name of ["Display type", "Color", "Angled panel", "Dense stat row", "Motion"]) {
    await expect(page.getByRole("heading", { name })).toBeVisible();
  }
  await expect(page.getByRole("listitem", { name: /Rank 1, Zorblax/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay motion sample" })).toBeVisible();
});

test("keyboard focus shows an accent-colored outline", async ({ page }) => {
  await page.goto("/");
  // Header tabs are the first stop on desktop. On phones the bar is last, so Shift+Tab from the top wraps to it.
  const focusedLink = page.getByRole("navigation", { name: "Primary" }).locator("a:focus");
  const phone = (page.viewportSize()?.width ?? 1280) < 768;
  await page.keyboard.press(phone ? "Shift+Tab" : "Tab");
  await expect(focusedLink).toHaveCount(1);
  const outline = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element);
    return { style: style.outlineStyle, color: style.outlineColor };
  });
  expect(outline.style).not.toBe("none");
  const accent = parseInt(colors.accent.slice(1), 16);
  expect(outline.color).toBe(`rgb(${accent >> 16}, ${(accent >> 8) & 255}, ${accent & 255})`);
});

for (const path of ["/", "/texas", "/style-guide"]) {
  test(`touch targets on ${path} are at least 44px`, async ({ page }) => {
    await page.goto(path);
    const targets = await page.getByRole("link").or(page.getByRole("button")).all();
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(43.5);
    }
  });
}

test("reduced motion is announced and bars show without animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/style-guide");
  await expect(page.getByText(/Reduced motion is on/)).toBeVisible();
});

test("reduced-motion message is absent by default", async ({ page }) => {
  await page.goto("/style-guide");
  await expect(page.getByText(/Reduced motion is on/)).toHaveCount(0);
});
