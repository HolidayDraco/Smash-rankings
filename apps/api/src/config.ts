import { loadEnv } from "@sr/core";
import { z } from "zod";

/** Expo's web dev servers (`pnpm dev`), allowed only outside production. */
const DEV_ORIGINS = ["http://localhost:8081", "http://localhost:8082"];

/** Comma-separated origins, each normalized to scheme://host[:port]. */
const allowedOriginsSchema = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url().transform((url) => new URL(url).origin)));

/** Must be fully anchored and https-only, e.g. ^https://sr-app-[a-z0-9-]+-clay\.vercel\.app$ */
const allowedOriginPatternSchema = z
  .string()
  .startsWith("^https://")
  .endsWith("$")
  .transform((pattern, ctx) => {
    try {
      return new RegExp(pattern);
    } catch {
      ctx.addIssue({ code: "custom", message: "not a valid regular expression" });
      return z.NEVER;
    }
  })
  .optional();

export interface ApiConfig {
  databaseUrl: string;
  allowedOrigins: string[];
  allowedOriginPattern: RegExp | undefined;
}

export class InvalidConfigError extends Error {
  constructor(key: string, reason: string) {
    super(`Invalid ${key}: ${reason}. See .env.example.`);
    this.name = "InvalidConfigError";
  }
}

function parseSetting<T>(key: string, schema: z.ZodType<T>, value: string | undefined): T {
  const result = schema.safeParse(value === "" ? undefined : value);
  if (!result.success) {
    throw new InvalidConfigError(key, result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}

/**
 * Read the API's settings once at startup. Throws MissingEnvError (naming the
 * variable, never its value) when DATABASE_URL is missing or invalid, and
 * InvalidConfigError for malformed CORS settings.
 */
export function loadApiConfig(source: Record<string, string | undefined> = process.env): ApiConfig {
  const { DATABASE_URL } = loadEnv(["DATABASE_URL"], source);
  const configured = parseSetting("ALLOWED_ORIGINS", allowedOriginsSchema, source.ALLOWED_ORIGINS);
  const dev = source.NODE_ENV !== "production";
  return {
    databaseUrl: DATABASE_URL,
    allowedOrigins: dev ? [...configured, ...DEV_ORIGINS] : configured,
    allowedOriginPattern: parseSetting(
      "ALLOWED_ORIGIN_PATTERN",
      allowedOriginPatternSchema,
      source.ALLOWED_ORIGIN_PATTERN,
    ),
  };
}
