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
