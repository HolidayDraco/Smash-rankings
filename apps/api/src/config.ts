import { loadEnv } from "@sr/core";

/** Expo's web dev servers (`pnpm dev`), allowed only outside production. */
const DEV_ORIGINS = ["http://localhost:8081", "http://localhost:8082"];

export interface ApiConfig {
  databaseUrl: string;
  allowedOrigins: string[];
}

/**
 * Read the API's settings once at startup. Throws MissingEnvError (naming the
 * variable, never its value) when DATABASE_URL is missing or invalid.
 */
export function loadApiConfig(source: Record<string, string | undefined> = process.env): ApiConfig {
  const { DATABASE_URL } = loadEnv(["DATABASE_URL"], source);
  const configured = (source.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const dev = source.NODE_ENV !== "production";
  return {
    databaseUrl: DATABASE_URL,
    allowedOrigins: dev ? [...configured, ...DEV_ORIGINS] : configured,
  };
}
