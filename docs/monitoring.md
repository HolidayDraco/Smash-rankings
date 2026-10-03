# Monitoring (Sentry)

Sentry is a service that emails us when something breaks, with enough detail to fix it. We use its free Developer plan, for errors only (no performance tracing, no session replay).

**It is off until a DSN is set.** A DSN is the "address" of a Sentry project. With no DSN, nothing is sent, nothing is logged, and nothing slows down. To turn it on:

| Where                            | Variable                 | Turns on                          |
| -------------------------------- | ------------------------ | --------------------------------- |
| GitHub → Settings → Actions secrets | `SENTRY_DSN`          | Job failures and cron check-ins   |
| Vercel env vars (API project)    | `SENTRY_DSN`             | API crashes                       |
| Vercel env vars (app project)    | `EXPO_PUBLIC_SENTRY_DSN` | Website crashes (DSNs are public) |

Notes:

- **Jobs:** the GitHub secret only takes effect once the scheduled-jobs workflow (`.github/workflows/ingest.yml`, PR #16) passes `SENTRY_DSN` and `SENTRY_CRONS` to the sync and rate steps. That is a follow-up after #16 merges.
- **Typos break the deploy:** a `SENTRY_DSN` that isn't a valid web address stops the API (and the jobs) from starting, with an error naming `SENTRY_DSN`. This is deliberate ("fail fast"), so a bad value is noticed instead of silently turning alerts off.
- **Missed-run monitors only count real scheduled runs.** Test runs (`--dry-run`) and runs on your own computer report errors but never check in, so they can't create stray monitors.
- In Sentry's project settings for the website, also turn on **"Prevent Storing of IP Addresses"** as a second safety net.

## Alerts Clay will get

- **Failed sync** or **failed rate**: the job's error, tagged `job:sync` or `job:rate`.
- **Expired start.gg token**: a _fatal_ alert titled "start.gg token rejected (expired?)". Tokens expire once a year; make a new one at start.gg → Developer Settings and update the `STARTGG_TOKEN` secret.
- **Missed check-in**: sync and rate tell Sentry when they start and finish. If a run doesn't start within its window (sync: 60 minutes after the planned time, rate: 115), or runs past its time limit (sync 50 minutes, rate 20), Sentry raises an alert. One missed run is ignored, because GitHub sometimes drops scheduled runs; two in a row alert. A failed sync also skips rate, so expect both alerts together.
- **API 5xx**: any unexpected API error (not "not found" or "bad request" answers).
- **Website crash**: a page that hits an unexpected error. Visitors see a "Something went wrong" panel with a Reload button.

⚠ Unverified: how many cron monitors the free plan includes. If Sentry says the quota is used up, set the Actions variable `SENTRY_CRONS=sync` to monitor sync only, or `SENTRY_CRONS=0` for none. Error alerts keep working either way.

## What is sent, and what is not

Sent: the error message, the code location (stack trace), which job or page failed, and the time. Not sent: names, emails, IP addresses, cookies, request headers, request bodies, or the computer's name. (In Sentry SDK 11 the old `sendDefaultPii: false` switch became `dataCollection`; ours turns every category off. It lives in `packages/core/src/scrub.ts`.)

Before anything leaves, a scrubber (`packages/core/src/scrub.ts`, unit-tested) also replaces these with `[redacted]`:

- the start.gg token (any `Bearer …` value)
- database addresses (`postgres://…`, `postgresql://…`)
- web-address parameters named like token, key, or secret (`?api_key=…`)
- `Authorization` and `Cookie` headers
- the exact values of `STARTGG_TOKEN` and `DATABASE_URL` (jobs and API only; the website has no secrets)

The website loads Sentry's code only when a DSN is set, so visitors don't download it (about 1.2 MB) while Sentry is off.
