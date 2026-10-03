/**
 * Privacy scrubber for error reports (Sentry's beforeSend / beforeBreadcrumb). Pure: it walks a
 * copy of the event and rewrites every string, so nothing secret leaves the process.
 */

const REDACTED = "[redacted]";
/** Header and field names whose values are always dropped. */
const SENSITIVE_KEY =
  /^(authorization|proxy-authorization|cookie|set-cookie|cookies)$|token|secret|password|api[-_]?key/i;
const BEARER = /\bBearer\s+[^\s"',;]+/gi;
const DATABASE_URL = /\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi;
/** A query parameter whose name mentions token, key, or secret, e.g. `?api_key=…`. */
const SECRET_QUERY_PARAM = /((?:^|[?&])[^=&#\s]*(?:token|key|secret)[^=&#\s]*=)[^&#\s"']*/gi;
/** Shorter "secrets" would wreck ordinary text when removed literally. */
const MIN_LITERAL_SECRET_LENGTH = 6;
const MAX_DEPTH = 12;

/** Remove secret-looking values from one string. `secrets` are exact values to remove too. */
export function scrubText(text: string, secrets: readonly string[] = []): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length >= MIN_LITERAL_SECRET_LENGTH) result = result.split(secret).join(REDACTED);
  }
  return result
    .replace(DATABASE_URL, "[database url redacted]")
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(SECRET_QUERY_PARAM, `$1${REDACTED}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** A `[name, value]` query pair whose name looks like a secret parameter. */
function isSecretPair(value: unknown): value is [string, unknown] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    /^[\w.-]*(?:token|key|secret)[\w.-]*$/i.test(value[0])
  );
}

function scrubValue(value: unknown, secrets: readonly string[], depth: number): unknown {
  if (typeof value === "string") return scrubText(value, secrets);
  // Fail closed: anything nested deeper than this is dropped rather than sent unscrubbed.
  if (depth >= MAX_DEPTH) return "[too deep]";
  if (Array.isArray(value)) {
    // Sentry may store a query string as [name, value] pairs.
    return value.map((item) =>
      isSecretPair(item) ? [item[0], REDACTED] : scrubValue(item, secrets, depth + 1),
    );
  }
  if (!isPlainObject(value)) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    copy[key] = SENSITIVE_KEY.test(key) ? REDACTED : scrubValue(inner, secrets, depth + 1);
  }
  return copy;
}

/**
 * Returns a scrubbed copy of a Sentry event or breadcrumb: secret values, Bearer tokens, database
 * URLs, secret query parameters, and Authorization/Cookie headers are replaced with "[redacted]".
 */
export function scrubEvent<T>(event: T, secrets: readonly string[] = []): T {
  // The walk keeps the event's shape; only string leaves change.
  return scrubValue(event, secrets, 0) as T;
}

/**
 * Sentry's `dataCollection` setting (SDK 11 replaced `sendDefaultPii` with it): collect no user
 * info, cookies, headers, bodies, query params, or local variables. Plain data, so core needs no
 * Sentry dependency.
 */
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [] as never[],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};

/** beforeSend and beforeBreadcrumb hooks with the given secret values baked in. */
export function createSentryScrubber(secrets: readonly (string | undefined)[] = []) {
  const known = secrets.filter((secret): secret is string => Boolean(secret));
  const scrub = <T>(event: T): T => scrubEvent(event, known);
  return { beforeSend: scrub, beforeBreadcrumb: scrub };
}
