import * as Sentry from "@sentry/node";
import type { Database } from "@sr/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { initApiSentry } from "./sentry";

const FAKE_DB_URL = "postgres://user:fake-pw-marker@db.example.test:5432/sr";

describe("initApiSentry", () => {
  afterEach(async () => {
    await Sentry.close();
  });

  it("does nothing without SENTRY_DSN", () => {
    expect(initApiSentry({}, [FAKE_DB_URL])).toBeUndefined();
    expect(initApiSentry({ SENTRY_DSN: "" }, [FAKE_DB_URL])).toBeUndefined();
    expect(Sentry.isInitialized()).toBe(false);
  });

  it("sends a scrubbed error through the transport when SENTRY_DSN is set", async () => {
    const sent: string[] = [];
    const reportError = initApiSentry(
      { SENTRY_DSN: "https://public@o0.ingest.example.test/1" },
      [FAKE_DB_URL],
      {
        transport: () => ({
          send: (envelope) => {
            sent.push(JSON.stringify(envelope));
            return Promise.resolve({});
          },
          flush: () => Promise.resolve(true),
        }),
      },
    );
    expect(reportError).toBeDefined();
    await reportError?.(new Error(`could not connect to ${FAKE_DB_URL}`));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("could not connect to [redacted]");
    expect(sent[0]).not.toContain("fake-pw-marker");
  });
});

describe("API onError", () => {
  const failingDb = (): Database => {
    throw new Error("database exploded");
  };

  it("reports a 500 but not a 404", async () => {
    const reportError = vi.fn(() => Promise.resolve());
    const app = createApp({ getDb: failingDb, allowedOrigins: [], reportError });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect((await app.request("/v1/meta")).status).toBe(500);
      expect(reportError).toHaveBeenCalledTimes(1);
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "database exploded" }),
      );

      expect((await app.request("/no-such-page")).status).toBe(404);
      expect((await app.request("/v1/players/abc")).status).toBe(400);
      expect(reportError).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("still answers 500 when the reporter itself fails", async () => {
    const reportError = vi.fn(() => Promise.reject(new Error("sentry down")));
    const app = createApp({ getDb: failingDb, allowedOrigins: [], reportError });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect((await app.request("/v1/meta")).status).toBe(500);
    } finally {
      consoleError.mockRestore();
    }
  });
});
