import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = 4200;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CONSOLE_PORT = 4300;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: BASE_URL,
  },
  webServer: [
    {
      // A production build, not `next dev` — installability and the service
      // worker's caching behavior are what actually ships, and dev mode's
      // HMR/refresh traffic would otherwise pollute the shell cache assertion.
      command: `pnpm exec next build && pnpm exec next start --port ${PORT}`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        // Lets /api/feed honour a `_testNow` override (see that route and
        // feed-2am.spec.ts) so the "simulated 2:15am" e2e run doesn't have
        // to wait for real clock time. Never set outside this test process.
        // Also gates /api/test/flag-count (flag-roundtrip.spec.ts) and
        // page.tsx's own `_testNow`/`_mapEnabled` overrides (map.spec.ts).
        FEED_TEST_MODE: "1",
        // F1.5: inlined into the client bundle at this build (NEXT_PUBLIC_
        // vars are compile-time). Not a real Mapbox account — map.spec.ts
        // only asserts marker DOM presence, which mapbox-gl computes from
        // the map's projection synchronously on construction, before any
        // network request to Mapbox's API would even resolve.
        NEXT_PUBLIC_MAPBOX_TOKEN: "pk.e2e-test-token-not-a-real-mapbox-account",
      },
    },
    {
      // Only flag-roundtrip.spec.ts talks to this — the console app,
      // started against the same live Postgres apps/web's own e2e run
      // already requires, with AUTH_TEST_MODE deliberately unset so
      // curator-store/session-store/queue-store all take their normal
      // Drizzle-backed path (see console's app/api/test/live-session).
      command: `pnpm exec next dev --port ${CONSOLE_PORT}`,
      cwd: path.resolve(__dirname, "../console"),
      url: `http://127.0.0.1:${CONSOLE_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        AUTH_SECRET: "e2e-flag-roundtrip-secret-not-for-production",
        E2E_LIVE_SESSION_TEST_MODE: "1",
      },
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
