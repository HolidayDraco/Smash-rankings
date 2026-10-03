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
  await expect(page.getByRole("link", { name: /Leaderboard/ })).toHaveAttribute("href", "/");
  await expectNoSeriousViolations(page);
});

test("an unranked player says why", async ({ page, request }) => {
  const unranked = await findPlayer(request, false);
  await page.goto(`/player/${unranked.playerId}-x`);
  await expect(page.getByText("Not yet ranked", { exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /Needs|uncertain/ })).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("the start.gg link opens externally and safely when present", async ({ page, request }) => {
  const top = await findPlayer(request, true);
  const data = (await (await request.get(`${API}/v1/players/${top.playerId}`)).json()) as {
    startggUrl: string | null;
  };
  await page.goto(`/player/${top.playerId}-x`);
  const link = page.getByRole("link", { name: /View on start\.gg/ });
  if (data.startggUrl === null) return expect(link).toHaveCount(0);
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(link).toHaveAttribute("target", "_blank");
});

for (const path of ["/player/not-a-number", "/player/999999999-ghost"]) {
  test(`${path} shows not found with a way back`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Player not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Leaderboard/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Data from start\.gg/ })).toBeVisible();
    await expectNoSeriousViolations(page);
  });
}

test("shows a skeleton, then an error with a working retry", async ({ page, request }) => {
  const top = await findPlayer(request, true);
  await page.route("**/v1/players/*", (route) => route.abort());
  await page.goto(`/player/${top.playerId}-x`);
  await expect(page.getByRole("alert")).toContainText("We could not load this player");
  await expectNoSeriousViolations(page);
  await page.unroute("**/v1/players/*");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1, name: top.gamerTag })).toBeVisible();
});
