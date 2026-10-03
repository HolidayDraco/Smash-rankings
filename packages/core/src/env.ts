import { z } from "zod";

const envShape = {
  STARTGG_TOKEN: z.string().min(1),
  DATABASE_URL: z.url(),
  SENTRY_DSN: z.url(),
} as const;

export type EnvKey = keyof typeof envShape;
export type Env = { [K in EnvKey]: z.infer<(typeof envShape)[K]> };

export class MissingEnvError extends Error {
  constructor(readonly keys: readonly EnvKey[]) {
    super(
      `Missing or invalid environment variable(s): ${keys.join(", ")}. ` +
        "Set them in GitHub Actions secrets, Vercel env vars, or a local .env (see .env.example).",
    );
    this.name = "MissingEnvError";
  }
}

/**
 * Read and validate only the env vars a process needs. Fails fast with the
 * variable *names* that are missing; values are never included in the error.
 */
export function loadEnv<const K extends EnvKey>(
  keys: readonly K[],
  source: Record<string, string | undefined> = process.env,
): Pick<Env, K> {
  const values: Partial<Env> = {};
  const badKeys: EnvKey[] = [];
  for (const key of keys) {
    const result = envShape[key].safeParse(source[key]);
    if (result.success) values[key] = result.data;
    else badKeys.push(key);
  }
  if (badKeys.length > 0) throw new MissingEnvError(badKeys);
  return values as Pick<Env, K>;
}

/**
 * Like loadEnv, but a variable that is not set is simply left out. One that is
 * set and malformed still fails fast (by name only).
 */
export function loadOptionalEnv<const K extends EnvKey>(
  keys: readonly K[],
  source: Record<string, string | undefined> = process.env,
): Partial<Pick<Env, K>> {
  const present = keys.filter((key) => source[key] !== undefined && source[key] !== "");
  return loadEnv(present, source) as Partial<Pick<Env, K>>;
}
