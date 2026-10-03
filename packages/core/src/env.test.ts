import { describe, expect, it } from "vitest";
import { loadEnv, MissingEnvError } from "./env";

describe("loadEnv", () => {
  it("returns only the requested keys when they are valid", () => {
    const env = loadEnv(["STARTGG_TOKEN"], { STARTGG_TOKEN: "abc", DATABASE_URL: "nope" });
    expect(env).toEqual({ STARTGG_TOKEN: "abc" });
  });

  it("fails fast naming every missing key", () => {
    expect(() => loadEnv(["STARTGG_TOKEN", "DATABASE_URL"], {})).toThrowError(
      /STARTGG_TOKEN, DATABASE_URL/,
    );
  });

  it("rejects an invalid URL without echoing the value", () => {
    const secretLookingValue = "postgres-but-not-a-url-s3cr3t";
    try {
      loadEnv(["DATABASE_URL"], { DATABASE_URL: secretLookingValue });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MissingEnvError);
      expect((error as Error).message).not.toContain(secretLookingValue);
    }
  });

  it("treats an empty string as missing", () => {
    expect(() => loadEnv(["STARTGG_TOKEN"], { STARTGG_TOKEN: "" })).toThrowError(MissingEnvError);
  });
});
