# Pulse Sydney

A curated "what's good tonight" PWA for Sydney nightlife.

## Structure

pnpm workspace + Turborepo monorepo:

```
apps/web       public PWA, no auth, no user accounts
apps/console   curator console, Auth.js magic link, ~10 allow-listed users
packages/db    Drizzle schema, migrations, queries, freshness logic (shared)
packages/ui    shared React components
packages/config  shared tsconfig / eslint / tailwind presets
```

## Two Vercel projects, one repo

`apps/web` and `apps/console` are deployed as **two separate Vercel projects**
pointed at this same GitHub repo. Each project's **Root Directory** setting
determines which app it builds:

| Vercel project    | Root Directory   | Public URL role                    |
| ----------------- | ----------------- | ----------------------------------- |
| `pulse-web`        | `apps/web`         | public PWA                          |
| `pulse-console`     | `apps/console`      | curator console (Auth.js, allow-list) |

Production URLs (Production Branch = `develop`):

- `pulse-web`: https://pulse-web-clbh-three.vercel.app
- `pulse-console`: https://pulse-console1.vercel.app

Both projects build via Turborepo's dependency graph, so a Vercel build for
either app picks up `packages/db`, `packages/ui`, and `packages/config`
automatically (`turbo` walks `^build` before building the app itself).

Every Vercel function in both projects runs in `syd1` — enforced by
`vercel.json` (`{"regions": ["syd1"]}`) in each app directory. Do not remove
or override this.

## Local development

```bash
pnpm install
pnpm dev        # runs both apps via turbo
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## CI

`.github/workflows/ci.yml` has two jobs:

- `ci` — runs on every pull request: cached install → typecheck → lint → test
  → build, fail fast.
- `latency-baseline` — runs on every push to `develop` (i.e. after a PR
  merges), after `ci` passes. Hits the live `pulse-web` production URL (see
  [Sydney latency baseline](#sydney-latency-baseline)) and fails the job if
  the region isn't `syd1` or p75 exceeds the budget.

## Instrumentation

- **Sentry** — both apps init client/server/edge (`sentry.*.config.ts` +
  `instrumentation.ts`), source maps upload from whichever build runs
  `next build` (`vercel build` in `staging-deploy.yml`, or Vercel's own
  git-integration build for production) when `SENTRY_AUTH_TOKEN` is set,
  release tagged by `VERCEL_GIT_COMMIT_SHA`. PII scrubbing (no coordinates,
  no email) is enforced via `@pulse/analytics`'s `scrubPii`. Required env
  vars and where to get them: see
  [docs/infra/provisioning.md](docs/infra/provisioning.md#sentry-error-tracking-both-apps).
- **Vercel Speed Insights** — `apps/web` only (`<SpeedInsights />` in the
  root layout).
- **`@pulse/analytics`** — typed `track()` over a closed event-name union
  (see `packages/analytics/src/events.ts`); adding an event requires editing
  that union. Drops any payload key matching `/lat|lng|latitude|longitude|coords/`
  before it leaves the app. `apps/web`'s `/debug/events` page (dev-only,
  404s in production) renders the last 50 events tracked in the current
  browser.

## Migrations

Migrations run exclusively from a GitHub Actions workflow, never from a
Vercel build step. See `packages/db` once schema work lands. Expand/contract
only — destructive schema changes require a two-PR sequence.

## Environments

Three environments, each with its own Neon branch and its own path to a
Vercel deployment:

| Environment    | Git trigger                              | Vercel deployment                                                                 | Database                                       |
| -------------- | ----------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Production** | push to `main` (migrations only)          | Vercel's own git integration, Production Branch = `develop` (both projects)        | Neon `production` branch (the project's default branch) |
| **Staging**    | push to `develop`                         | `.github/workflows/staging-deploy.yml` — CLI-built Preview deployment aliased to a dedicated staging domain, independent of the production deployment `develop` also triggers | Neon `staging` branch, reset nightly from a production snapshot (`staging-reset.yml`) |
| **Preview**    | PR opened/reopened against `develop`      | Vercel's own git integration (normal Preview deployment for the PR's branch)        | Neon `preview/pr-<number>` branch, created off Neon `production` per PR (`preview-db.yml`) |

Note that git branch names and Neon branch names are two separate
namespaces: the Neon project's default/primary branch is named `production`,
independent of which *git* branch (`main`) triggers migrations against it.

Notes:

- `develop` is intentionally both: the branch Vercel treats as Production
  (unchanged, existing setup — see below) *and* the branch that
  `staging-deploy.yml` also builds independently for a preproduction smoke
  surface. These are two separate deployments of the same commit; the
  staging one never touches the production domain or the production DB.
- Migrations (`migrate.yml`) apply to the Neon `production` branch on push to
  the git `main` branch — not `develop`. `main` exists in this repo purely as
  the migration trigger / PR base for schema changes; `develop` is where
  day-to-day feature work merges. `preview-db.yml` branches PR databases off
  Neon `production` (not `staging`) so every PR starts from the same
  baseline production does.
- `staging-reset.yml` runs nightly and uses Neon's "reset from parent" API,
  which recreates `staging`'s storage (schema + data) from production's
  current head — no separate seed or migrate step needed after a reset.
- `preview-db.yml` deletes its Neon branch and the Vercel env var override
  scoped to that PR's branch when the PR closes.

### Required secrets / vars

| Name                              | Where                          | Purpose                                                        |
| ----------------------------------| --------------------------------| ----------------------------------------------------------------|
| `NEON_API_KEY`                    | repo secret                     | Create/delete/reset Neon branches                               |
| `NEON_PROJECT_ID`                 | repo secret                     | Neon project containing the `production` and `staging` branches |
| `VERCEL_TOKEN`                    | repo secret                     | Vercel CLI/API auth                                             |
| `VERCEL_ORG_ID`                   | repo secret                     | Vercel team id                                                  |
| `VERCEL_PROJECT_ID_WEB`           | repo secret                     | `pulse-web` Vercel project id                                   |
| `VERCEL_PROJECT_ID_CONSOLE`       | repo secret                     | `pulse-console` Vercel project id                                |
| `STAGING_WEB_ALIAS`               | repo/environment variable       | Domain aliased to `pulse-web`'s staging deployment               |
| `STAGING_CONSOLE_ALIAS`           | repo/environment variable       | Domain aliased to `pulse-console`'s staging deployment           |

`pulse-web` / `pulse-console` Vercel projects also need a `DATABASE_URL`
Preview env var scoped to `gitBranch: develop` (Project → Settings →
Environment Variables → Preview, "Branch" override) pointing at the Neon
`staging` connection string — that's what `staging-deploy.yml`'s
`vercel pull --git-branch=develop` picks up.

## Environment variables

`packages/db` parses `DATABASE_URL`, `UPSTASH_REDIS_REST_URL`, and
`UPSTASH_REDIS_REST_TOKEN` with zod at import time — a missing or malformed
var throws immediately rather than failing on first query. See
[docs/infra/provisioning.md](docs/infra/provisioning.md) for exact Neon
(ap-southeast-2, PostGIS) and Upstash Redis (ap-southeast-2) setup steps.
These three vars must also be declared in `turbo.json`'s `globalEnv` (already
done) or `turbo run build`/`dev` will silently strip them from the task's
environment.

## Sydney latency baseline

`apps/web` exposes `GET /api/_latency` (`apps/web/app/api/%5Flatency/route.ts`
— the `%5F` folder name is Next.js's escape for a literal leading underscore
in a route segment), which times a Neon `SELECT 1` and an Upstash `GET` in
`syd1` and returns `{ region, dbMs, redisMs, totalMs }`.

```bash
pnpm latency:smoke https://pulse-web-clbh-three.vercel.app
```

Hits that endpoint 50 times, prints p50/p75/p95 round trip, and writes
`docs/baselines/latency-YYYY-MM-DD.md`. Exits non-zero if the reported region
isn't `syd1` or p75 exceeds 250ms.

`.github/workflows/ci.yml` runs this automatically as the `latency-baseline`
job on every push to `develop`, against the `PULSE_WEB_URL` repo variable
(currently the URL above).
