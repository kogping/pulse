# Provisioning: Neon + Upstash (ap-southeast-2)

This environment has no Neon, Upstash, or Vercel CLI/API credentials available,
so these resources were not provisioned live. These are the exact steps an
operator with account access runs to provision them. Once done, fill in the
env vars in `.env` (local) and the two Vercel projects (`pulse-web`,
`pulse-console`) per [packages/db/src/env.ts](../../packages/db/src/env.ts).

## Neon (Postgres + PostGIS, ap-southeast-2)

1. https://console.neon.tech → **New Project**.
2. Project name: `pulse-sydney`.
3. **Postgres version**: latest stable (17).
4. **Region**: `AWS Asia Pacific (Sydney) — ap-southeast-2`. This is
   non-negotiable — see invariant 1 in `CLAUDE.md`. Neon's Sydney region is
   the only one that keeps the DB colocated with `syd1` Vercel functions.
5. Create the project. Neon provisions a default database (`neondb`) and role.
6. Open the SQL editor on the new project and run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   ```
   Confirm with `SELECT postgis_version();`.
7. Project → **Connection Details** → copy the **pooled** connection string
   (uses PgBouncer, required for serverless/edge function concurrency). It
   looks like:
   ```
   postgresql://<user>:<password>@<host>-pooler.ap-southeast-2.aws.neon.tech/neondb?sslmode=require
   ```
   This is `DATABASE_URL`.
8. (Recommended) Project → **Settings** → **Compute** → set autosuspend to a
   short value (e.g. 5 min) — this is a low-traffic curated app, no need to
   keep compute warm.
9. Add `DATABASE_URL` to:
   - local `.env` (never committed — see `.gitignore`)
   - the GitHub Actions repo/environment secrets (migrations run from CI,
     never from a Vercel build step — invariant 4)
   - both Vercel projects' environment variables (`pulse-web` needs read
     access for the latency probe; `pulse-console` needs read/write)

## Upstash Redis (ap-southeast-2)

1. https://console.upstash.com → **Create Database**.
2. Name: `pulse-sydney`.
3. **Type**: Regional (not Global — a single-region regional DB is enough and
   avoids multi-region replication cost; global would also violate the
   "runs in syd1 only" spirit of invariant 1 by fanning writes out).
4. **Region**: `AWS ap-southeast-2 (Sydney)`.
5. **Eviction**: leave disabled (this is used for caching/latency probes, not
   session storage today) — revisit once real cache keys land.
6. Create. On the database's page, open **REST API**:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
7. Add both to local `.env` and both Vercel projects' environment variables
   (same placement rationale as `DATABASE_URL` above).

## Verifying region colocation

After both resources exist and env vars are set on `pulse-web`, deploy and
hit `GET /api/_latency` (see [packages/db](../../packages/db) and
[apps/web/app/api/_latency/route.ts](../../apps/web/app/api/_latency/route.ts)).
`region` in the response should read `syd1`, and `dbMs` / `redisMs` should
each be single-digit-to-low-double-digit milliseconds if Neon/Upstash are
actually in `ap-southeast-2`. Run `scripts/latency-smoke.ts` against the
deployed URL to get a repeatable p50/p75/p95 baseline (see
[docs/baselines](../baselines)) — it fails the build/CI step if the reported
region isn't `syd1` or p75 round trip exceeds 500ms (the CI runner isn't in
Sydney, so this has headroom for network jitter on top of the
single-digit-to-low-double-digit `dbMs`/`redisMs` that actually proves
region colocation).

## Sentry (error tracking, both apps)

1. https://sentry.io → create (or reuse) an org, then two projects:
   `pulse-web` and `pulse-console` (platform: Next.js).
2. Each project's **Client Keys (DSN)** page has the DSN. Add to both Vercel
   projects' environment variables (Production + Preview, so `vercel pull`
   in `staging-deploy.yml` and Vercel's own git-integration production build
   both pick them up — same placement rationale as `DATABASE_URL` above):
   - `SENTRY_DSN` — server/edge init (`sentry.server.config.ts`,
     `sentry.edge.config.ts`)
   - `NEXT_PUBLIC_SENTRY_DSN` — client init (`sentry.client.config.ts`),
     exposed to the browser bundle by design (DSNs are not secret)
3. Settings → **Auth Tokens** → create a token scoped to `project:releases`
   and `project:write` for source map upload. Add as `SENTRY_AUTH_TOKEN` to
   both Vercel projects' environment variables. Also add `SENTRY_ORG` (the
   org slug) and `SENTRY_PROJECT` (`pulse-web` / `pulse-console`
   respectively — different value per Vercel project, same var name).
4. `SENTRY_AUTH_TOKEN` gates the `@sentry/nextjs` webpack plugin
   (`withSentryConfig` in each app's `next.config.mjs`): present → uploads
   source maps and tags the release; absent (local dev, CI's `pnpm build`
   step, forked PRs) → the build still succeeds, it just skips upload
   (`silent: true`).
5. Release tagging uses `VERCEL_GIT_COMMIT_SHA` /
   `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`, which Vercel injects automatically
   when "Automatically expose System Environment Variables" is enabled on
   each project (Settings → Environment Variables) — no extra var to set.
6. PII scrubbing (`beforeSend`/`beforeBreadcrumb`, CLAUDE.md: no
   coordinates, no email in breadcrumbs) is enforced in code
   (`@pulse/analytics`'s `scrubPii`), not by Sentry project config — nothing
   to set up here beyond the DSN/token above.

## Vercel Edge Config (feature flags / kill switches)

1. https://vercel.com/<team> → **Storage** → **Create Database** → **Edge
   Config**.
2. Name: `pulse-sydney-flags`. One store, shared by both `pulse-web` and
   `pulse-console` — flags aren't per-app secrets, and both apps need to
   agree on the same value for a given key.
3. **Connect** the store to both `pulse-web` and `pulse-console` projects
   (Storage tab on each project → **Connect Store**). This automatically
   sets the `EDGE_CONFIG` environment variable (a connection string, not a
   secret to hand-copy) on each project — Production + Preview.
4. Seed the initial items (Storage → the store → **Items**):
   - `map_enabled` → `true`
   - `transport_live_enabled` → `false`
   - `accessibility_filter_enabled` → `false`
   - `precinct_<id>_enabled` → `true` for each precinct actually launched
   No item is required for a flag to work — `packages/config`'s `getFlag()`
   falls back to a safe in-code default (see
   [docs/runbook/kill-switches.md](../runbook/kill-switches.md)) for any key
   that isn't set, so this step is about matching intent, not correctness.
5. See [docs/runbook/kill-switches.md](../runbook/kill-switches.md) for what
   each flag does and how to flip one in an emergency.

## Vercel Deployment Protection on `pulse-console`

Also done via dashboard, no CLI credentials available here:

1. https://vercel.com/<team>/pulse-console → **Settings** → **Deployment
   Protection**.
2. Set **Vercel Authentication** to "Standard Protection" (protects all
   Preview deployments; Production stays reachable by the ~10 allow-listed
   curators via Auth.js magic link).
3. Leave **Production** deployments un-gated by Vercel Authentication — Auth.js
   is the access control layer there, not Vercel's own gate — but confirm
   **Protection Bypass for Automation** is configured if CI/E2E needs to hit
   preview deployments (Playwright), using a bypass secret stored in GitHub
   Actions secrets, never committed.
4. Save. Combined with the `X-Robots-Tag: noindex` middleware (see
   `apps/console/middleware.ts`), this keeps non-production console
   deployments both unindexed and unreachable without auth.
