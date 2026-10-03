import { describe, expect, it } from "vitest";
import { createSentryScrubber, scrubEvent, scrubText } from "./scrub";

// Obviously fake values, built at runtime so no secret scanner mistakes them for real ones.
const FAKE_TOKEN = ["fake", "startgg", "token", "xxxxxxxxxxxx"].join("-");
const FAKE_DB_URL = `postgresql://user:${"pw-fake-123"}@db.example.test:5432/sr?sslmode=require`;

describe("scrubText", () => {
  it("removes any Bearer value", () => {
    expect(scrubText(`Authorization: Bearer ${FAKE_TOKEN} failed`)).toBe(
      "Authorization: Bearer [redacted] failed",
    );
  });
  it("removes postgres:// and postgresql:// URLs", () => {
    const text = scrubText(`could not reach ${FAKE_DB_URL} or postgres://u:p@h/x`);
    expect(text).not.toContain("pw-fake-123");
    expect(text).not.toContain("u:p@h");
    expect(text).toBe("could not reach [database url redacted] or [database url redacted]");
  });
  it("removes query parameters named like token, key, or secret", () => {
    expect(scrubText("https://x.test/a?q=ace&api_key=abc&token=def&client_secret=g#top")).toBe(
      "https://x.test/a?q=ace&api_key=[redacted]&token=[redacted]&client_secret=[redacted]#top",
    );
    expect(scrubText("access_token=abc&page=2")).toBe("access_token=[redacted]&page=2");
  });
  it("removes literal secret values wherever they appear", () => {
    expect(scrubText(`token was ${FAKE_TOKEN}.`, [FAKE_TOKEN])).toBe("token was [redacted].");
  });
  it("ignores very short literal secrets so ordinary text survives", () => {
    expect(scrubText("a normal message", ["a"])).toBe("a normal message");
  });
  it("leaves ordinary text alone", () => {
    expect(scrubText("Leaderboard failed for ?q=mkleo")).toBe("Leaderboard failed for ?q=mkleo");
  });
});

describe("scrubEvent", () => {
  const event = {
    message: `boom at ${FAKE_DB_URL}`,
    exception: { values: [{ type: "Error", value: `sent ${FAKE_TOKEN} to start.gg` }] },
    request: {
      url: "https://api.example.test/v1/search?q=ace",
      headers: { Authorization: `Bearer ${FAKE_TOKEN}`, Cookie: "session=abc", Accept: "*/*" },
      cookies: { session: "abc" },
      query_string: [
        ["q", "ace"],
        ["apiKey", "zzz"],
      ],
    },
    breadcrumbs: [{ category: "fetch", data: { url: "https://x.test/?secret=s3" } }],
    extra: { when: 3 },
  };

  it("removes the token, the database URL, headers, and secret values", () => {
    const scrubbed = scrubEvent(event, [FAKE_TOKEN]);
    const json = JSON.stringify(scrubbed);
    expect(json).not.toContain(FAKE_TOKEN);
    expect(json).not.toContain("pw-fake-123");
    expect(json).not.toContain("session=abc");
    expect(json).not.toContain("zzz");
    expect(json).not.toContain("s3");
    expect(scrubbed.request.headers).toEqual({
      Authorization: "[redacted]",
      Cookie: "[redacted]",
      Accept: "*/*",
    });
    expect(scrubbed.request.cookies).toBe("[redacted]");
    expect(scrubbed.request.query_string).toEqual([
      ["q", "ace"],
      ["apiKey", "[redacted]"],
    ]);
    expect(scrubbed.request.url).toBe(event.request.url);
    expect(scrubbed.extra).toEqual({ when: 3 });
  });

  it("does not modify the original event", () => {
    const before = JSON.stringify(event);
    scrubEvent(event, [FAKE_TOKEN]);
    expect(JSON.stringify(event)).toBe(before);
  });

  it("drops values nested too deeply to check", () => {
    let deep: unknown = FAKE_TOKEN;
    for (let i = 0; i < 20; i++) deep = { inner: deep };
    expect(JSON.stringify(scrubEvent(deep))).not.toContain(FAKE_TOKEN);
  });
});

describe("createSentryScrubber", () => {
  it("bakes literal secrets into both hooks and skips unset ones", () => {
    const { beforeSend, beforeBreadcrumb } = createSentryScrubber([FAKE_TOKEN, undefined, ""]);
    expect(beforeSend({ message: `x ${FAKE_TOKEN}` }).message).toBe("x [redacted]");
    expect(beforeBreadcrumb({ message: `y ${FAKE_TOKEN}` }).message).toBe("y [redacted]");
  });
});
