import { defineConfig, devices } from "@playwright/test";

const PORT = 4200;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: BASE_URL,
  },
  webServer: {
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
      FEED_TEST_MODE: "1",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
