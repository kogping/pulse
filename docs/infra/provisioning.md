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
region isn't `syd1` or p75 exceeds 250ms.

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
