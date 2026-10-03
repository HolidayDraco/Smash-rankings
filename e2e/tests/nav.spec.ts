import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const API = process.env.E2E_API_URL ?? `http://localhost:${process.env.API_PORT ?? 8787}`;
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });

test.describe("two-tab navigation", () => {
  test("phone width shows the bottom bar, not header tabs", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/");
    const nav = primaryNav(page);
    await expect(nav).toHaveCount(1);
    await expect(nav.getByRole("link")).toHaveText(["Dashboard", "Texas"]);
    const box = await nav.boundingBox();
    // It sits at the very bottom of the screen, below the header.
    expect(box!.y + box!.height).toBeGreaterThan(PHONE.height - 8);
    expect(box!.y).toBeGreaterThan(PHONE.height / 2);
    const header = await page.getByRole("banner").boundingBox();
    expect(header!.y + header!.height).toBeLessThan(box!.y);
  });

  test("desktop width shows the tabs inside the header", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    const nav = primaryNav(page);
    await expect(nav).toHaveCount(1);
    await expect(
      page.getByRole("banner").getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
    await expect(nav.getByRole("link")).toHaveText(["Dashboard", "Texas"]);
  });

  test("the bar follows a window resize", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    await expect(
      page.getByRole("banner").getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
    await page.setViewportSize(PHONE);
    await expect(page.getByRole("banner").getByRole("navigation")).toHaveCount(0);
    await expect(primaryNav(page)).toHaveCount(1);
  });

  for (const [label, viewport] of [
    ["phone", PHONE],
    ["desktop", DESKTOP],
  ] as const) {
    test(`clicking each tab navigates and sets aria-current (${label})`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      const nav = primaryNav(page);
      await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(nav.getByRole("link", { name: "Texas" })).not.toHaveAttribute("aria-current");

      await nav.getByRole("link", { name: "Texas" }).click();
      await expect(page).toHaveURL(/\/texas$/);
      await expect(page.getByRole("heading", { level: 1, name: "Texas" })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Texas" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(nav.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute(
        "aria-current",
      );

      await nav.getByRole("link", { name: "Dashboard" }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });
  }

  test("tabs are reachable by keyboard", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    const texas = primaryNav(page).getByRole("link", { name: "Texas" });
    await texas.focus();
    await expect(texas).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/texas$/);
  });

  test("player pages mark Dashboard as active", async ({ page, request }) => {
    const body = (await (await request.get(`${API}/v1/leaderboard`)).json()) as {
      entries: { playerId: string }[];
    };
    await page.goto(`/player/${body.entries[0]?.playerId}-x`);
    await expect(primaryNav(page).getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("the public nav hides style guide and status; footer keeps only the methodology link", async ({
    page,
  }) => {
    await page.goto("/texas");
    await expect(page.getByRole("link", { name: "Style guide" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Status" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Footer" }).getByRole("link")).toHaveText([
      "How rankings work",
    ]);
  });

  test("hidden pages still load by URL", async ({ page }) => {
    for (const [path, heading] of [
      ["/style-guide", "Style guide"],
      ["/status", "Status"],
      ["/methodology", "How rankings work"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    }
  });

  test("texas placeholder has the right copy and no serious axe issues", async ({ page }) => {
    await page.goto("/texas");
    await expect(page).toHaveTitle("Texas | Bracket Index");
    await expect(page.getByText("City power rankings are coming soon.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Data from start\.gg/ })).toBeVisible();
    for (const viewport of [PHONE, DESKTOP]) {
      await page.setViewportSize(viewport);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      const bad = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(bad.map((v) => v.id)).toEqual([]);
    }
  });
});
