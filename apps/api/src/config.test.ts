import { MissingEnvError } from "@sr/core";
import { describe, expect, it } from "vitest";
import { loadApiConfig } from "./config";

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
    });
    expect(loadApiConfig(base).allowedOrigins).toEqual([
      "http://localhost:8081",
      "http://localhost:8082",
    ]);
  });
});
