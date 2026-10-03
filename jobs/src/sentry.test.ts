import * as Sentry from "@sentry/node";
import type * as SentryModule from "@sentry/node";
import { SENTRY_DATA_COLLECTION } from "@sr/core";
import { StartggAuthError } from "@sr/startgg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDbJob, runJob, type JobResult } from "./harness";
import { CRON_MONITORS, STARTGG_AUTH_MESSAGE, startJobMonitor } from "./sentry";

// Spy on Sentry's entry points; nothing is ever sent.
vi.mock("@sentry/node", async (importOriginal) => ({
  ...(await importOriginal<typeof SentryModule>()),
  initWithoutDefaultIntegrations: vi.fn(),
  captureException: vi.fn(),
  captureCheckIn: vi.fn(() => "check-in-1"),
  flush: vi.fn(() => Promise.resolve(true)),
}));

const DSN = "https://public@o0.ingest.example.test/1";
const DB_URL = "postgres://127.0.0.1:1/sr-fake-db-marker";
const FAKE_TOKEN = ["fake", "token", "for", "tests"].join("-");
const ok = (): Promise<JobResult> => Promise.resolve({ eventsTouched: 0, summary: "fine" });

let stderr: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => stderr.mockRestore());

const out = () => undefined;

describe("job monitoring", () => {
  it("is a no-op without SENTRY_DSN", async () => {
    const code = await runDbJob("rate", ["--dry-run"], ok, { env: { DATABASE_URL: DB_URL }, out });
    expect(code).toBe(0);
    expect(Sentry.initWithoutDefaultIntegrations).not.toHaveBeenCalled();
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
    expect(Sentry.flush).not.toHaveBeenCalled();
  });

  it("starts Sentry without personal data, but sends no check-in for a dry run", async () => {
    const env = { DATABASE_URL: DB_URL, SENTRY_DSN: DSN, GITHUB_ACTIONS: "true" };
    expect(await runDbJob("rate", ["--dry-run"], ok, { env, out })).toBe(0);
    expect(Sentry.initWithoutDefaultIntegrations).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: DSN,
        dataCollection: SENTRY_DATA_COLLECTION,
        includeServerName: false,
        tracesSampleRate: 0,
      }),
    );
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.flush).toHaveBeenCalled();
  });

  it("captures a failed run's scrubbed error with its job tag, checks in error, and flushes", async () => {
    const env = { DATABASE_URL: DB_URL, SENTRY_DSN: DSN };
    const fail = () => Promise.reject(new Error(`boom at ${DB_URL}`));
    expect(await runDbJob("rate", ["--dry-run"], fail, { env, out })).toBe(1);
    const [error, context] = vi.mocked(Sentry.captureException).mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("sr-fake-db-marker");
    expect((error as Error).stack).not.toContain("sr-fake-db-marker");
    expect(context).toEqual({ tags: { job: "rate" } });
    const flushOrder = vi.mocked(Sentry.flush).mock.invocationCallOrder[0] ?? 0;
    expect(flushOrder).toBeGreaterThan(
      vi.mocked(Sentry.captureException).mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it("captures a rejected start.gg token as fatal with a clear message", async () => {
    const env = { STARTGG_TOKEN: FAKE_TOKEN, SENTRY_DSN: DSN };
    const fail = () => Promise.reject(new StartggAuthError(`401 for Bearer ${FAKE_TOKEN}`));
    expect(await runJob("sync", ["--dry-run"], fail, { env, out })).toBe(1);
    const [error, context] = vi.mocked(Sentry.captureException).mock.calls[0] ?? [];
    expect((error as Error).message).toBe(STARTGG_AUTH_MESSAGE);
    expect(context).toMatchObject({ level: "fatal", tags: { job: "sync" } });
    expect(JSON.stringify(context)).not.toContain(FAKE_TOKEN);
  });

  it("rejects a malformed SENTRY_DSN as a usage error, by name", async () => {
    const env = { DATABASE_URL: DB_URL, SENTRY_DSN: "not a url" };
    expect(await runDbJob("rate", ["--dry-run"], ok, { env, out })).toBe(2);
    expect(String(stderr.mock.calls[0]?.[0])).toContain("SENTRY_DSN");
  });
});

describe("cron check-ins", () => {
  const scheduled = { SENTRY_DSN: DSN, GITHUB_ACTIONS: "true" };
  const real = { dryRun: false };

  it("checks in in_progress then ok for a scheduled run", async () => {
    await startJobMonitor("rate", scheduled, [], real).succeeded();
    expect(vi.mocked(Sentry.captureCheckIn).mock.calls).toEqual([
      [{ monitorSlug: "rate", status: "in_progress" }, CRON_MONITORS.rate],
      [{ checkInId: "check-in-1", monitorSlug: "rate", status: "ok" }],
    ]);
    expect(Sentry.flush).toHaveBeenCalled();
  });

  it("checks in error after reporting a failure", async () => {
    await startJobMonitor("sync", scheduled, [], real).failed(new Error("x"), "x");
    expect(vi.mocked(Sentry.captureCheckIn).mock.calls.at(-1)).toEqual([
      { checkInId: "check-in-1", monitorSlug: "sync", status: "error" },
    ]);
  });

  it("sends none for dry runs or runs outside GitHub Actions", async () => {
    await startJobMonitor("sync", scheduled, [], { dryRun: true }).succeeded();
    await startJobMonitor("sync", { SENTRY_DSN: DSN }, [], real).succeeded();
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
  });

  it("skips jobs turned off by SENTRY_CRONS, and jobs without a monitor", async () => {
    for (const crons of ["0", "sync", " SYNC "]) {
      await startJobMonitor("rate", { ...scheduled, SENTRY_CRONS: crons }, [], real).succeeded();
    }
    await startJobMonitor("discover", scheduled, [], real).succeeded();
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
    await startJobMonitor("sync", { ...scheduled, SENTRY_CRONS: " SYNC " }, [], real).succeeded();
    expect(Sentry.captureCheckIn).toHaveBeenCalledTimes(2);
  });

  it("warns about unknown names in SENTRY_CRONS", async () => {
    await startJobMonitor("sync", { ...scheduled, SENTRY_CRONS: "none" }, [], real).succeeded();
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
    expect(String(stderr.mock.calls[0]?.[0])).toContain("unknown monitor(s): none");
  });
});
