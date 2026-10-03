# ADR-0001: Technology stack, with static web pages for now

**Status:** Accepted, October 3, 2026
**Deciders:** architect subagent, under Clay's locked blueprint decisions (1–8)

## Context

`docs/blueprint.md` §1 picks the stack: a pnpm + Turborepo monorepo, an Expo Router universal app (web now, iOS/Android later), a Hono API on Vercel, Neon Postgres with Drizzle, GitHub Actions for data jobs, and Glicko-2 rankings. It assumed **Expo SDK 58**, where Expo Router "server rendering" became stable [E2]. Server rendering means the server builds each page with real data before sending it, which helps search engines and link previews.

What we found on October 3, 2026:
- On npm, the current stable Expo (`expo@latest`) is **SDK 57.0.26**. SDK 58 exists only as a **pre-release** (`expo@next`, 58.0.3) [NPM1]. Pre-releases can change or break without notice.
- Vercel is not connected to the repo yet, so PRs have no preview links.
- This cloud session can't reach `api.start.gg` and has no start.gg token or database address.

The blueprint planned for this: "fall back to `web.output: \"static\"` with client-side data fetching" if server rendering isn't workable [blueprint §2.4].

## Decision

1. **Monorepo:** pnpm workspaces + Turborepo, Node LTS, TypeScript `strict`. Packages: `core`, `config`, `db`, `startgg`, `ranking`, `ui`. Apps: `app` and `api`. Jobs live in `jobs/`.
2. **App:** **Expo SDK 57 (stable)** with Expo Router and **`web.output: "static"`**. In plain terms, the website is built ahead of time as plain page files: the layout, header, footer, and empty "skeleton" rows. When a visitor opens a page, the browser asks our API for the latest numbers and fills them in. That data fetching uses **TanStack Query**, a library that handles loading states, caching, and retries [TQ1]. The same code later builds the iOS and Android apps.
3. **API:** **Hono** on **Vercel Functions** (Hobby). It is read-only, every response is Zod-validated, and responses are CDN-cached (`s-maxage=300, stale-while-revalidate=86400`). The app gets typed API calls from Hono's client. List endpoints cap at 100 rows, so there's no bulk export [SG7].
4. **Hosting:** two Vercel Hobby projects from one repo: `apps/app` (static files) and `apps/api` (functions). Static files are served from Vercel's CDN and don't count as function calls [V1].
5. **Database:** **Neon Postgres Free** + **Drizzle ORM** and drizzle-kit migrations [N1]. Tests use a throwaway Postgres 16 (a CI service container or local binaries), never production.
6. **start.gg:** one client in `packages/startgg` with a ≤ 60 req/min limiter and backoff. Types come from **GraphQL Code Generator** run against a **committed schema file** (`packages/startgg/schema/startgg.graphql`), not live introspection, because the session can't reach start.gg. Test fixtures are synthetic until re-recorded with a real token [SG1][SG2].
7. **Scheduling:** GitHub Actions scheduled workflows (free on public repos), not Vercel cron, which runs at most once a day on Hobby [GH1][V2].
8. **Quality:** Zod at every boundary, Vitest, Playwright + axe, ESLint/Prettier, gitleaks, and Sentry Developer (free) [Q1].

**Revisit trigger (follow-up, not Phase 0/1):** when SDK 58 is on npm's `latest` tag and Expo's Vercel adapter docs cover it, open a spike PR to try server rendering for player pages. Adopt it only through a new ADR.

## Alternatives considered

- **SDK 58 pre-release now.** It gives server rendering today, but pre-release builds can break, and a broken build blocks every PR. Rejected for now.
- **Next.js website + separate Expo app.** It has the best web SEO, but routes and screens get written twice. Expo's own case study describes a team leaving this setup because features drifted [E4]. It stays possible later as `apps/web` without touching shared packages.
- **EAS Hosting.** Its free tier allows 10 CPU-ms per request [E3], which is too tight for server rendering, and static files are just as easy on Vercel.
- **Supabase instead of Neon.** Clay locked Neon (decision 7). Supabase pauses free projects after a week idle [S1].
- **Vercel cron for jobs.** Hobby allows once a day [V2], which can't support the 2-hour refresh (decision 6).

## Consequences

- **Good:** simple and cheap. Pages are files on a CDN, and the only server code is the small cached API. It works on Vercel Hobby at $0. It needs no unreleased software.
- **Trade-off (SEO):** the first page load doesn't contain player names or numbers, so search engines and link previews see less. Per-route titles still work. This matters most for player pages and is addressed when server rendering is revisited (Phase 2's SEO work is the natural point).
- **Trade-off (UX):** every data screen needs loading, empty, and error states. Skeleton rows keep it feeling fast.
- **Ops:** dynamic routes such as `/player/[id]-[slug]` need rewrites in `apps/app/vercel.json`. The API needs CORS for the app's domain(s). Clay must create two Vercel projects (see `docs/plans/phase-0.md`).
- **Until Vercel is connected,** PR evidence is CI results plus Playwright screenshots at 390 px and 1280 px.

## Sources

- [NPM1] npm registry, `expo` package dist-tags (`latest` 57.0.26, `next` 58.0.3), checked Oct 3, 2026 — https://www.npmjs.com/package/expo
- [E1] Expo Router static rendering — https://docs.expo.dev/router/web/static-rendering/
- [E2] Expo Router server rendering — https://docs.expo.dev/router/web/server-rendering/
- [E3] Expo/EAS pricing — https://expo.dev/pricing
- [E4] Expo blog, brownfield RN + Next.js to one Expo app — https://expo.dev/blog/from-a-brownfield-react-native-and-next-js-stack-to-one-expo-app
- [TQ1] TanStack Query — https://tanstack.com/query/latest
- [V1] Vercel Hobby plan — https://vercel.com/docs/plans/hobby
- [V2] Vercel Cron usage and pricing — https://vercel.com/docs/cron-jobs/usage-and-pricing
- [N1] Neon pricing — https://neon.com/pricing
- [S1] Supabase pricing — https://supabase.com/pricing
- [GH1] GitHub Actions billing — https://docs.github.com/en/billing/concepts/product-billing/github-actions
- [SG1] start.gg authentication — https://developer.start.gg/docs/authentication
- [SG2] start.gg rate limits — https://developer.start.gg/docs/rate-limits
- [SG7] START.GG API Terms of Use — https://www.start.gg/about/apitos
- [Q1] Sentry pricing — https://sentry.io/pricing/
- `docs/blueprint.md` §1, §2.4, §2.5, §6 risk 5
