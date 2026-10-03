import { MissingEnvError } from "@sr/core";
import { describe, expect, it } from "vitest";
import { InvalidConfigError, loadApiConfig } from "./config";

describe("loadApiConfig", () => {
  it("fails fast with MissingEnvError when DATABASE_URL is missing", () => {
    expect(() => loadApiConfig({})).toThrowError(MissingEnvError);
    expect(() => loadApiConfig({})).toThrowError(/DATABASE_URL/);
  });

  it("names an invalid DATABASE_URL without leaking its value", () => {
    const secretLookingValue = "not-a-url-but-s3cr3t-password";
    try {
      loadApiConfig({ DATABASE_URL: secretLookingValue });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MissingEnvError);
      expect((error as Error).message).toContain("DATABASE_URL");
      expect((error as Error).message).not.toContain(secretLookingValue);
    }
  });

  it("parses ALLOWED_ORIGINS and adds localhost only outside production", () => {
    const base = { DATABASE_URL: "postgres://u:p@db.example.com/x" };
    const origins = " https://a.example , https://b.example,";
    expect(loadApiConfig({ ...base, ALLOWED_ORIGINS: origins, NODE_ENV: "production" })).toEqual({
      databaseUrl: base.DATABASE_URL,
      allowedOrigins: ["https://a.example", "https://b.example"],
      allowedOriginPattern: undefined,
    });
    expect(loadApiConfig(base).allowedOrigins).toEqual([
      "http://localhost:8081",
      "http://localhost:8082",
    ]);
  });

  it("normalizes ALLOWED_ORIGINS entries to bare origins and rejects non-URLs", () => {
    const base = { DATABASE_URL: "postgres://u:p@db.example.com/x", NODE_ENV: "production" };
    expect(
      loadApiConfig({
        ...base,
        ALLOWED_ORIGINS: "https://App.Example.com/path/,https://x.example:8443/",
      }).allowedOrigins,
    ).toEqual(["https://app.example.com", "https://x.example:8443"]);
    expect(() => loadApiConfig({ ...base, ALLOWED_ORIGINS: "app.example.com" })).toThrowError(
      InvalidConfigError,
    );
  });

  it("accepts only an anchored https ALLOWED_ORIGIN_PATTERN", () => {
    const base = { DATABASE_URL: "postgres://u:p@db.example.com/x" };
    const preview = "^https://sr-app-[a-z0-9-]+-clay\\.vercel\\.app$";
    const pattern = loadApiConfig({
      ...base,
      ALLOWED_ORIGIN_PATTERN: preview,
    }).allowedOriginPattern;
    expect(pattern?.test("https://sr-app-git-feat-x-clay.vercel.app")).toBe(true);
    expect(pattern?.test("https://sr-app-x-clay.vercel.app.evil.example")).toBe(false);
    expect(
      loadApiConfig({ ...base, ALLOWED_ORIGIN_PATTERN: "" }).allowedOriginPattern,
    ).toBeUndefined();
    for (const bad of [
      "https://.*\\.vercel\\.app$",
      "^https://x\\.example",
      "^http://x$",
      "^https://(x$",
    ]) {
      expect(() => loadApiConfig({ ...base, ALLOWED_ORIGIN_PATTERN: bad })).toThrowError(
        /ALLOWED_ORIGIN_PATTERN/,
      );
    }
  });
});
