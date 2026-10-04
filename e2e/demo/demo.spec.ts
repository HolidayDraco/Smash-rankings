import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Any uncaught page error fails the test.
test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("dashboard renders its sections from the bundled sample data", async ({ page }) => {
  await page.goto("/");
  for (const name of [
    "Texas Top 10",
    "This week's movers",
    "Upsets of the week",
    "This week's events",
    "Year at a glance",
  ]) {
    await expect(page.getByRole("heading", { name })).toBeVisible();
  }
  await expect(page.getByRole("list", { name: /top 10 players/ }).getByRole("link")).toHaveCount(
    10,
  );
  await expect(page.getByRole("status", { name: /^Last updated / })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Try again/ })).toHaveCount(0);
  // Sample events don't exist on start.gg, so there are no links to them.
  await expect(page.getByRole("link", { name: /on start\.gg/ })).toHaveCount(0);
});

test("every page shows the Demo data tag and a sample-data footer", async ({ page }) => {
  for (const path of ["/", "/texas", "/leaderboard", "/status"]) {
    await page.goto(path);
    const tag = page.getByRole("note", { name: "Demo data: sample rankings, not real results" });
    await expect(tag).toBeVisible();
    await expect(tag).toContainText("Demo data");
    // Sample players are made up, so the footer must not credit start.gg.
    await expect(
      page.getByText("Sample data, not from start.gg").filter({ visible: true }),
    ).toBeVisible();
    await expect(page.getByText("Data from start.gg", { exact: true })).toHaveCount(0);
  }
});

test("Texas renders", async ({ page }) => {
  await page.goto("/texas");
  await expect(page.getByRole("heading", { level: 1, name: "Texas" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Texas cities" })).toBeVisible();
});

test("the leaderboard search finds a Sample_ player", async ({ page }) => {
  await page.goto("/leaderboard");
  await page.getByRole("searchbox").fill("sample_");
  const results = page.getByRole("link", { name: /Sample_/ });
  await expect(results.first()).toBeVisible();
  const label = (await results.first().getAttribute("aria-label")) ?? "";
  expect(label).toContain("Sample_");
});

test("a player page opens from the leaderboard, and an unknown player says not found", async ({
  page,
}) => {
  await page.goto("/leaderboard");
  const first = page
    .getByRole("list", { name: /top 100 leaderboard/ })
    .getByRole("link")
    .first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page).toHaveURL(/\/player\/\d+-/);
  await expect(page.getByRole("heading", { level: 1, name: /^Sample_/ })).toBeVisible();
  await expect(
    page.getByText("Sample data, not from start.gg").filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /View on start\.gg/ })).toHaveCount(0);

  await page.goto("/player/999999-nobody");
  await expect(page.getByText("Player not found")).toBeVisible();
});

test("the dashboard has no serious or critical accessibility violations", async ({ page }) => {
  await page.goto("/");
  const top = page.getByRole("list", { name: /top 10 players/ });
  await expect(top).toBeVisible();
  // Lists fade in; wait until the fade ends so axe measures real colors.
  await expect(top.locator("..")).toHaveCSS("opacity", "1");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual(
    [],
  );
});
