import { SENTRY_DATA_COLLECTION } from "@sr/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spy on the SDK; nothing is ever sent. `loaded` records whether the lazy import happened.
const sdk = vi.hoisted(() => ({ loaded: false, init: vi.fn(), captureException: vi.fn() }));
vi.mock("@sentry/react", () => {
  sdk.loaded = true;
  return { init: sdk.init, captureException: sdk.captureException };
});

const DSN = "https://public@o0.ingest.example.test/1";

/** A fresh copy of the module, since it keeps the loaded SDK in module state. */
const load = async () => {
  vi.resetModules();
  return import("./sentry.web");
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  sdk.loaded = false;
  vi.clearAllMocks();
  vi.stubGlobal("window", {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("web Sentry", () => {
  it("never loads the SDK without a valid DSN", async () => {
    for (const dsn of ["", "not a url"]) {
      vi.stubEnv("EXPO_PUBLIC_SENTRY_DSN", dsn);
      const { initSentry, reportRenderError } = await load();
      initSentry();
      reportRenderError(new Error("x"));
      await settle();
    }
    expect(sdk.loaded).toBe(false);
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
  });

  it("does nothing during the static build's server render", async () => {
    vi.stubEnv("EXPO_PUBLIC_SENTRY_DSN", DSN);
    vi.stubGlobal("window", undefined);
    const { initSentry } = await load();
    initSentry();
    await settle();
    expect(sdk.loaded).toBe(false);
  });

  it("starts once with no personal data, a scrubber, and no session pings", async () => {
    vi.stubEnv("EXPO_PUBLIC_SENTRY_DSN", DSN);
    const { initSentry } = await load();
    initSentry();
    initSentry();
    await settle();
    expect(sdk.init).toHaveBeenCalledTimes(1);
    const options = sdk.init.mock.calls[0]?.[0];
    expect(options).toMatchObject({ dsn: DSN, dataCollection: SENTRY_DATA_COLLECTION });
    expect(options.beforeSend).toBeTypeOf("function");
    expect(options.beforeBreadcrumb).toBeTypeOf("function");
    const kept = options.integrations([{ name: "BrowserSession" }, { name: "Dedupe" }]);
    expect(kept).toEqual([{ name: "Dedupe" }]);
  });

  it("reports render errors with the component stack, even before the SDK finishes loading", async () => {
    vi.stubEnv("EXPO_PUBLIC_SENTRY_DSN", DSN);
    const { initSentry, reportRenderError } = await load();
    initSentry();
    const error = new Error("render failed");
    reportRenderError(error, "\n    at Leaderboard");
    await settle();
    reportRenderError(error);
    await settle();
    expect(sdk.captureException.mock.calls).toEqual([
      [error, { contexts: { react: { componentStack: "\n    at Leaderboard" } } }],
      [error, {}],
    ]);
  });
});
