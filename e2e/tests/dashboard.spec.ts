import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

const SECTIONS = [
  "Texas Top 10",
  "This week's movers",
  "Upsets of the week",
  "This week's events",
  "Year at a glance",
];

async function loaded(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("list", { name: /top 10 players/ })).toBeVisible();
  // Lists fade in; wait until the fade ends so axe measures real colors.
  await expect(page.getByRole("list", { name: /top 10 players/ }).locator("..")).toHaveCSS(
    "opacity",
    "1",
  );
}

async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual(
    [],
  );
}

test("the Demo data tag is absent when the app talks to the real API", async ({ page }) => {
  await loaded(page);
  await expect(page.getByRole("note", { name: /^Demo data/ })).toHaveCount(0);
  await expect(page.getByText("Demo data")).toHaveCount(0);
});

test("header strip shows the region, year, week range and last-updated badge", async ({ page }) => {
  await loaded(page);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2, name: /^Texas Smash, \d{4}$/ })).toBeVisible();
  await expect(page.getByText(/^Week of Mon \w{3} \d+ – Sun \w{3} \d+$/)).toBeVisible();
  await expect(page.getByRole("status", { name: /^Last updated / })).toBeVisible();
  await expect(page.getByRole("link", { name: /Data from start\.gg/ })).toBeVisible();
});

test("every section has a heading and content", async ({ page }) => {
  await loaded(page);
  for (const name of SECTIONS) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  await expect(page.getByRole("heading", { level: 3, name: "Climbers" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Fallers" })).toBeVisible();
  await expect(page.getByText(/^No .* yet/)).toHaveCount(0);
});

test("top 10 has at most 10 rows with readable changes, and a row opens the player page", async ({
  page,
}) => {
  await loaded(page);
  const rows = page.getByRole("list", { name: /top 10 players/ }).getByRole("link");
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(10);
  await expect(rows.first()).toHaveAttribute(
    "aria-label",
    /^Rank 1, .*, score \d+, (up \d+|down \d+|no change|new)$/,
  );
  await expect(rows.first()).toContainText(/▲\d+|▼\d+|—|NEW/);
  const label = (await rows.first().getAttribute("aria-label")) ?? "";
  const tag = /Sample_\w+/.exec(label)?.[0] ?? "";
  await rows.first().click();
  await expect(page).toHaveURL(/\/player\/\d+-sample-/);
  await expect(page.getByRole("heading", { level: 1, name: tag })).toBeVisible();
});

test("Full leaderboard link opens the searchable leaderboard", async ({ page }) => {
  await loaded(page);
  await page.getByRole("link", { name: /Full leaderboard/ }).click();
  await expect(page).toHaveURL(/\/leaderboard$/);
  await expect(page.getByRole("heading", { level: 1, name: "Leaderboard" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search players" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Dashboard" }),
  ).toHaveAttribute("aria-current", "page");
});

test("movers lists show climbers and fallers with links", async ({ page }) => {
  await loaded(page);
  for (const name of ["Climbers", "Fallers"]) {
    const list = page.getByRole("list", { name, exact: true });
    const links = list.getByRole("link");
    expect(await links.count()).toBeGreaterThan(0);
    expect(await links.count()).toBeLessThanOrEqual(3);
    await expect(links.first()).toHaveAttribute("href", /^\/player\/\d+-/);
  }
  await expect(
    page.getByRole("list", { name: "Climbers", exact: true }).getByRole("link").first(),
  ).toHaveAttribute("aria-label", /, up \d+$/);
  await expect(
    page.getByRole("list", { name: "Fallers", exact: true }).getByRole("link").first(),
  ).toHaveAttribute("aria-label", /, down \d+$/);
});

test("upset cards say who beat whom, with the rating gap and player links", async ({ page }) => {
  await loaded(page);
  const cards = page.getByRole("list", { name: "Upsets of the week" }).getByRole("listitem");
  expect(await cards.count()).toBeGreaterThan(0);
  expect(await cards.count()).toBeLessThanOrEqual(5);
  const first = cards.first();
  await expect(first.getByText("beat", { exact: true })).toBeVisible();
  await expect(first.getByText(/^Rating gap \d+$/)).toBeVisible();
  await expect(first.getByRole("group")).toHaveAttribute(
    "aria-label",
    /^Sample_\w+ beat Sample_\w+( \d+–\d+)?$/,
  );
  await expect(first.getByRole("link")).toHaveCount(2);
  await expect(first.getByRole("link").first()).toHaveAttribute("href", /^\/player\/\d+-sample-/);
});

test("events show details and an external start.gg link that opens a new tab", async ({ page }) => {
  await loaded(page);
  const events = page.getByRole("list", { name: "This week's events" }).getByRole("listitem");
  expect(await events.count()).toBeGreaterThan(0);
  const first = events.first();
  await expect(first).toContainText(/\d+ entrants/);
  await expect(first.getByText(/^Winner TBD$|^Winner$/).first()).toBeVisible();
  const link = first.getByRole("link", { name: /on start\.gg \(opens in a new tab\)/ });
  await expect(link).toHaveAttribute("href", /^https:\/\/www\.start\.gg\//);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
});

test("year tiles and highlights show", async ({ page }) => {
  await loaded(page);
  const tiles = page.getByRole("list", { name: "Year totals" }).getByRole("listitem");
  await expect(tiles).toHaveCount(3);
  await expect(tiles).toContainText(["Events", "Total entrants", "Unique players"]);
  await expect(page.getByRole("group", { name: "Biggest event" })).toContainText(/\d+ entrants/);
  await expect(
    page.getByRole("group", { name: "Biggest event" }).getByRole("link", { name: /start\.gg/ }),
  ).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("group", { name: "Most event wins" })).toContainText(/\d+ wins?/);
});

for (const [label, viewport] of [
  ["phone", PHONE],
  ["desktop", DESKTOP],
] as const) {
  test(`has no horizontal overflow and no serious axe issues (${label})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await loaded(page);
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
    await expectNoSeriousViolations(page);
  });
}

test("shows skeletons while loading and a friendly error with Try again", async ({ page }) => {
  await page.route("**/v1/dashboard*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.abort();
  });
  await page.goto("/");
  await expect(page.getByTestId("skeleton-row").first()).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("We could not load the dashboard");
  await expectNoSeriousViolations(page);
  await page.unroute("**/v1/dashboard*");
  await page.getByRole("button", { name: /Try again/ }).click();
  await expect(page.getByRole("list", { name: /top 10 players/ })).toBeVisible();
});

test("every section has a tidy empty state", async ({ page }) => {
  await page.route("**/v1/dashboard*", (route) =>
    route.fulfill({
      json: {
        header: {
          year: 2026,
          weekStart: "2026-09-28",
          weekEnd: "2026-10-04",
          lastUpdated: null,
        },
        top10: [],
        movers: { climbers: [], fallers: [] },
        upsets: [],
        weekEvents: [],
        weekEventCount: 0,
        year: {
          eventCount: 0,
          totalEntrants: 0,
          uniquePlayers: 0,
          biggestEvent: null,
          mostWins: null,
        },
        attribution: "Data from start.gg",
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByText("Week of Mon Sep 28 – Sun Oct 4")).toBeVisible();
  for (const name of SECTIONS) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  await expect(page.getByText("No players are ranked yet.")).toBeVisible();
  await expect(page.getByText("No climbers yet this week.")).toBeVisible();
  await expect(page.getByText("No fallers yet this week.")).toBeVisible();
  await expect(page.getByText("No upsets yet this week.")).toBeVisible();
  await expect(page.getByText("No events yet this week.")).toBeVisible();
  await expect(page.getByText("No counted events yet this year.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Full leaderboard/ })).toBeVisible();
  await expectNoSeriousViolations(page);
});
