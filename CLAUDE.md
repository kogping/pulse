PROJECT: Pulse Sydney — a curated "what's good tonight" PWA for Sydney nightlife.
Two apps in one Turborepo monorepo on GitHub, deployed to Vercel:
  apps/web     — public PWA, no auth, no user accounts
  apps/console — curator console, Auth.js magic link, ~10 allow-listed users
  packages/db  — Drizzle schema, migrations, queries, freshness logic (shared)
  packages/ui, packages/config

STACK: Next.js App Router, TypeScript strict, Drizzle ORM + Drizzle Kit,
Neon Postgres with PostGIS (region ap-southeast-2), Upstash Redis (ap-southeast-2),
Vercel Edge Config for flags, Mapbox GL JS (lazy), Sentry, Vercel Speed Insights,
Playwright for E2E, Vitest for unit/integration, GitHub Actions for CI and cron.

NON-NEGOTIABLE INVARIANTS — violating any of these is a failed task:
1. REGION. Every Vercel function runs in syd1. vercel.json must set
   {"regions": ["syd1"]}. Never introduce a function that runs elsewhere.
2. FRESHNESS IS COMPUTED, NEVER STORED. Attribute confidence
   (fresh | ageing | unconfirmed) is a pure SQL function of
   (attribute_key, last_verified_at, flag_count, now()). There is no
   confidence column, and no cron job that flips state.
3. NO BARE BADGE VALUES. Any API returning a venue attribute returns
   { value, confidence, lastVerifiedAt } or { confidence: 'unconfirmed' }.
   There must be no TypeScript shape that carries a value without provenance.
   Enforce with a discriminated union, not a convention.
4. MIGRATIONS RUN FROM GITHUB ACTIONS, NEVER FROM A VERCEL BUILD STEP.
   Expand/contract only; destructive changes require a two-PR sequence.
5. DEGRADE HONESTLY. When live transport data is missing, stale, or errored,
   show the scheduled timetable with a "scheduled, not live" label. Never show
   a countdown that might be wrong. Silence beats a confident wrong number.
6. NO PRECISE LOCATION PERSISTENCE. Coordinates are used in-request for
   ranking and discarded. Persist precinct + geohash-5 at most. Web sessions
   are anonymous rotating hashes.

CONVENTIONS: pnpm. Conventional commits. All work on a branch, opened as a PR
against `develop`. Tests colocated. No new runtime dependency in apps/web
without justification in the PR body (cold-start budget).

When finished, output: the branch name, files changed, and the exact command
that proves the Done-when condition.