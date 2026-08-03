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

`.github/workflows/ci.yml` runs on every pull request: cached install →
typecheck → lint → test → build, single job, fail fast.

## Migrations

Migrations run exclusively from a GitHub Actions workflow, never from a
Vercel build step. See `packages/db` once schema work lands. Expand/contract
only — destructive schema changes require a two-PR sequence.

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
pnpm latency:smoke https://<deployed-web-url>
```

Hits that endpoint 50 times, prints p50/p75/p95 round trip, and writes
`docs/baselines/latency-YYYY-MM-DD.md`. Exits non-zero if the reported region
isn't `syd1` or p75 exceeds 250ms.
