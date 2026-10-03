import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://localhost:8787";

interface Hit {
  playerId: string;
  gamerTag: string;
  rank: number | null;
}

async function findPlayer(request: APIRequestContext, ranked: boolean): Promise<Hit> {
  const url = ranked ? `${API}/v1/leaderboard` : `${API}/v1/search?q=sample_`;
  const body = (await (await request.get(url)).json()) as { entries?: Hit[]; results?: Hit[] };
  const hit = (body.entries ?? body.results ?? []).find((p) => (p.rank !== null) === ranked);
  if (!hit) throw new Error(`No seeded ${ranked ? "ranked" : "unranked"} player`);
  return hit;
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

// Any uncaught page error (such as a React hydration mismatch) fails the test.
test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("opens a player from a leaderboard row", async ({ page, request }) => {
  const top = await findPlayer(request, true);
  await page.goto("/");
  await page
    .getByRole("list", { name: /top 100 leaderboard/ })
    .getByRole("link", { name: new RegExp(`^Rank ${top.rank}, ${top.gamerTag},`) })
    .click();
  await expect(page).toHaveURL(new RegExp(`/player/${top.playerId}-`));
  await expect(page.getByRole("heading", { level: 1, name: top.gamerTag })).toBeVisible();
  await expect(page).toHaveTitle(new RegExp(`^${top.gamerTag} \\|`));
});

test("a ranked player shows rank, score, rating, stats, results and attribution", async ({
  page,
  request,
}) => {
  const top = await findPlayer(request, true);
  await page.goto(`/player/${top.playerId}-whatever-slug`);
  await expect(page.getByText(`#${top.rank}`, { exact: true })).toBeVisible();
  await expect(page.getByText(/^Score \d+/)).toBeVisible();
  await expect(page.getByText(/^Rating \d+ ± \d+/)).toBeVisible();
  const stats = page.getByRole("group", { name: "Stats" });
  await expect(stats).toContainText("Sets rated");
  await expect(stats).toContainText("12-month W–L");
  const results = page.getByRole("list", { name: "Recent results" });
  await expect(results.getByRole("listitem").first()).toContainText(/\d+(st|nd|rd|th) of \d+/);
  await expect(page.getByRole("link", { name: /Data from start\.gg/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to leaderboard" })).toHaveAttribute(
    "href",
    "/",
  );
  await expectNoSeriousViolations(page);
});

test("an unranked player says why", async ({ page, request }) => {
  const unranked = await findPlayer(request, false);
  await page.goto(`/player/${unranked.playerId}-x`);
  await expect(page.getByText("Not yet ranked", { exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /Needs|uncertain/ })).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("the seeded Sample_Dash links to start.gg, opening safely in a new tab", async ({
  page,
  request,
}) => {
  const hits = (await (await request.get(`${API}/v1/search?q=sample_dash`)).json()) as {
    results: Hit[];
  };
  await page.goto(`/player/${hits.results[0]?.playerId}-sample-dash`);
  const link = page.getByRole("link", { name: /View on start\.gg/ });
  await expect(link).toHaveAttribute("href", /^https:\/\/www\.start\.gg\//);
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(link).toHaveAttribute("target", "_blank");
});

test("a direct visit shows the skeleton, not 'not found', before the app loads", async ({
  page,
  request,
}) => {
  const top = await findPlayer(request, true);
  await page.route("**/*.js", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto(`/player/${top.playerId}-x`, { waitUntil: "commit" });
  await expect(page.getByRole("status", { name: "Loading player" })).toBeVisible();
  await expect(page.getByText("Player not found")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: top.gamerTag })).toBeVisible();
});

for (const path of ["/player/not-a-number", "/player/999999999-ghost"]) {
  test(`${path} shows not found with a way back`, async ({ page }) => {
    const notFoundResponse = path.includes("ghost")
      ? page.waitForResponse((r) => r.url().includes("/v1/players/999999999") && r.status() === 404)
      : Promise.resolve();
    await page.goto(path);
    await notFoundResponse;
    await expect(page.getByRole("heading", { name: "Player not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to leaderboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Data from start\.gg/ })).toBeVisible();
    await expectNoSeriousViolations(page);
  });
}

test("shows a skeleton, then an error with a working retry", async ({ page, request }) => {
  const top = await findPlayer(request, true);
  let fail: () => void = () => {};
  const failing = new Promise<void>((resolve) => (fail = resolve));
  await page.route("**/v1/players/*", async (route) => {
    await failing;
    await route.abort();
  });
  await page.goto(`/player/${top.playerId}-x`);
  await expect(page.getByRole("status", { name: "Loading player" })).toBeVisible();
  fail();
  await expect(page.getByRole("alert")).toContainText("We could not load this player");
  await expect(page.getByRole("heading", { level: 1, name: "Couldn't load player" })).toBeVisible();
  await expectNoSeriousViolations(page);
  await page.unroute("**/v1/players/*");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1, name: top.gamerTag })).toBeVisible();
});

test("an unranked player's score is labelled provisional", async ({ page, request }) => {
  const unranked = await findPlayer(request, false);
  await page.goto(`/player/${unranked.playerId}-x`);
  await expect(page.getByText(/^Provisional score \d+/)).toBeVisible();
});
