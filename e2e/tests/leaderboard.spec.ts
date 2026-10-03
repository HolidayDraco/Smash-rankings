import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://localhost:8787";

async function expectNoSeriousViolations(page: Page) {
  // Lists fade in; wait until they finish so axe measures real colors.
  const lists = page.getByRole("list");
  if ((await lists.count()) > 0)
    await expect(lists.first().locator("..")).toHaveCSS("opacity", "1");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual(
    [],
  );
}

const board = (page: Page) => page.getByRole("list", { name: /top 100 leaderboard/ });

test("shows the seeded ranked players in rank order, each linking to a player page", async ({
  page,
  request,
}) => {
  const { entries } = (await (await request.get(`${API}/v1/leaderboard`)).json()) as {
    entries: { rank: number; playerId: string; gamerTag: string }[];
  };
  expect(entries.length).toBeGreaterThan(5);
  await page.goto("/");
  const links = board(page).getByRole("link");
  await expect(links).toHaveCount(entries.length);
  for (const [index, entry] of entries.entries()) {
    const link = links.nth(index);
    await expect(link).toHaveAttribute(
      "aria-label",
      new RegExp(`^Rank ${entry.rank}, ${entry.gamerTag},`),
    );
    await expect(link).toHaveAttribute("href", new RegExp(`^/player/${entry.playerId}-sample-`));
  }
  await expect(links.first()).toContainText("Sample_");
});

test("shows the last-updated badge and the attribution", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("status", { name: /^Last updated .* ago, at / })).toBeVisible();
  await expect(page.getByText(/^Last updated /)).toBeVisible();
  await expect(page.getByRole("link", { name: /Data from start\.gg/ })).toBeVisible();
});

test("search finds a player, replaces the leaderboard, and Escape clears it", async ({ page }) => {
  await page.goto("/");
  const box = page.getByRole("searchbox", { name: "Search players" });
  await expect(board(page).getByRole("link").first()).toBeVisible();
  await box.fill("sample_d");
  const results = page.getByRole("list", { name: /search results/ });
  await expect(results.getByRole("link", { name: /Sample_Dash/ })).toBeVisible();
  await expect(results.getByRole("link", { name: /Sample_Dash/ })).toHaveAttribute(
    "href",
    /^\/player\/\d+-sample-dash$/,
  );
  await expect(board(page)).toHaveCount(0);
  await expectNoSeriousViolations(page);
  await box.press("Escape");
  await expect(box).toHaveValue("");
  await expect(board(page)).toBeVisible();
});

test("search shows an empty message when nothing matches", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search players" }).fill("zzzzqq");
  await expect(page.getByText("No players match that search.")).toBeVisible();
});

test("shows grey skeleton rows while loading", async ({ page }) => {
  await page.route("**/v1/leaderboard*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto("/");
  await expect(page.getByTestId("skeleton-row").first()).toBeVisible();
  await expect(board(page)).toHaveCount(0);
  await expect(board(page)).toBeVisible();
  await expect(page.getByTestId("skeleton-row")).toHaveCount(0);
});

test("shows an error with a working retry when the API is down", async ({ page }) => {
  await page.route("**/v1/leaderboard*", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("We could not load");
  await expectNoSeriousViolations(page);
  await page.unroute("**/v1/leaderboard*");
  await page.getByRole("button", { name: /Try again/ }).click();
  await expect(board(page)).toBeVisible();
});

test("leaderboard has no serious or critical axe violations once loaded", async ({ page }) => {
  await page.goto("/");
  await expect(board(page)).toBeVisible();
  await expectNoSeriousViolations(page);
});
