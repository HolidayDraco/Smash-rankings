import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const API = process.env.E2E_API_URL ?? `http://localhost:${process.env.API_PORT ?? 8787}`;

interface StatusBody {
  jobs: {
    job: string;
    lastRunAt: string | null;
    lastFinishedAt: string | null;
    ok: boolean | null;
  }[];
  attribution: unknown;
}

const LABELS: Record<string, string> = {
  discover: "Find new events",
  sync: "Pull results",
  backfill: "Catch up history",
  rate: "Update rankings",
};
const LATE_AFTER_HOURS: Record<string, number> = { discover: 26, sync: 3, backfill: 26, rate: 3 };

async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual(
    [],
  );
}

test.describe("/methodology", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/methodology");
  });

  test("renders its headings, tags, and the UltRank link", async ({ page }) => {
    await expect(page).toHaveTitle("How rankings work | Bracket Index");
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      "How rankings work | Bracket Index",
    );
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /Ultimate players/,
    );
    await expect(page.getByRole("heading", { level: 1, name: "How rankings work" })).toBeVisible();
    for (const name of [
      "What counts",
      "How a rating changes",
      /conservative score/,
      "Who appears on the leaderboard",
      "Rank change over 7 days",
      "Limits",
    ]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
    const ultrank = page.getByRole("link", { name: /UltRank/ });
    await expect(ultrank).toHaveAttribute("href", "https://www.ssbwiki.com/UltRank");
    await expect(ultrank).toHaveAttribute("rel", /noopener/);
  });

  test("has no serious or critical axe violations", async ({ page }) => {
    await expectNoSeriousViolations(page);
  });
});

test.describe("/status", () => {
  test("shows one row per job, matching the API", async ({ page, request }) => {
    const body = (await (await request.get(`${API}/v1/status`)).json()) as StatusBody;
    await page.goto("/status");
    await expect(page).toHaveTitle("Status | Bracket Index");
    const list = page.getByRole("list", { name: "Job status" });
    await expect(list.getByRole("listitem")).toHaveCount(4);
    for (const job of body.jobs) {
      const ageHours = job.lastRunAt ? (Date.now() - Date.parse(job.lastRunAt)) / 3_600_000 : 0;
      const expected = !job.lastRunAt
        ? "Not run yet"
        : !job.lastFinishedAt
          ? "Running"
          : job.ok === false
            ? "Failed"
            : ageHours < (LATE_AFTER_HOURS[job.job] ?? 0)
              ? "OK"
              : "Late";
      const row = list.getByRole("listitem", { name: new RegExp(`^${LABELS[job.job]}: `) });
      await expect(row).toContainText(expected);
      await expect(row).toHaveAttribute("aria-label", /Last run .+, at /);
    }
    // The seed's backfill run failed on purpose.
    await expect(list.getByRole("listitem", { name: /^Catch up history: Failed/ })).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Badge legend" }).getByRole("listitem"),
    ).toHaveCount(5);
  });

  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const states = [
    {
      text: "OK",
      run: () => ({ lastRunAt: hoursAgo(0.5), lastFinishedAt: hoursAgo(0.4), ok: true }),
    },
    {
      text: "Late",
      run: () => ({ lastRunAt: hoursAgo(30), lastFinishedAt: hoursAgo(30), ok: true }),
    },
    {
      text: "Failed",
      run: () => ({ lastRunAt: hoursAgo(1), lastFinishedAt: hoursAgo(1), ok: false }),
    },
    { text: "Not run yet", run: () => ({ lastRunAt: null, lastFinishedAt: null, ok: null }) },
    { text: "Running", run: () => ({ lastRunAt: hoursAgo(0.1), lastFinishedAt: null, ok: null }) },
  ];
  for (const state of states) {
    test(`forced badge state: ${state.text}`, async ({ page, request }) => {
      const body = (await (await request.get(`${API}/v1/status`)).json()) as StatusBody;
      const forced = { ...body, jobs: body.jobs.map((j) => ({ job: j.job, ...state.run() })) };
      await page.route("**/v1/status*", (route) =>
        route.fulfill({ json: forced, headers: { "access-control-allow-origin": "*" } }),
      );
      await page.goto("/status");
      const rows = page.getByRole("list", { name: "Job status" }).getByRole("listitem");
      await expect(rows).toHaveCount(4);
      for (const row of await rows.all()) await expect(row).toContainText(state.text);
      await expectNoSeriousViolations(page);
    });
  }

  test("shows a retry button when the API fails", async ({ page }) => {
    await page.route("**/v1/status*", (route) =>
      route.fulfill({ status: 500, headers: { "access-control-allow-origin": "*" }, body: "{}" }),
    );
    await page.goto("/status");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("shows a skeleton while loading", async ({ page }) => {
    await page.route("**/v1/status*", () => {});
    await page.goto("/status");
    await expect(page.getByTestId("skeleton-row")).toHaveCount(4);
  });

  test("has no serious or critical axe violations", async ({ page }) => {
    await page.goto("/status");
    await expect(page.getByRole("list", { name: "Job status" })).toBeVisible();
    await expectNoSeriousViolations(page);
  });
});

test("every route has the attribution and both footer links", async ({ page, request }) => {
  const leaderboard = (await (await request.get(`${API}/v1/leaderboard`)).json()) as {
    entries: { playerId: string }[];
  };
  const playerId = leaderboard.entries[0]?.playerId;
  for (const path of ["/", "/style-guide", "/methodology", "/status", `/player/${playerId}-x`]) {
    await page.goto(path);
    const footer = page.getByRole("navigation", { name: "Footer" });
    await expect(footer.getByRole("link", { name: "How rankings work" })).toHaveAttribute(
      "href",
      "/methodology",
    );
    await expect(footer.getByRole("link", { name: "Status" })).toHaveAttribute("href", "/status");
    await expect(page.getByRole("link", { name: /Data from start\.gg/ })).toBeVisible();
  }
});

test("footer link opens the methodology page", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Footer" })
    .getByRole("link", { name: "How rankings work" })
    .click();
  await expect(page).toHaveURL(/\/methodology$/);
});
