import { defineConfig, devices } from "@playwright/test";

const PORT = 4300;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Runs against `next dev` with AUTH_TEST_MODE=1, which swaps the curator and
// session stores (see lib/curator-store.ts, lib/session-store.ts) for
// in-memory ones and the email sender (lib/email.ts) for an in-memory inbox
// readable at /api/test/inbox. No live Neon database or real mailbox needed.
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
    command: `pnpm exec next dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      AUTH_TEST_MODE: "1",
      AUTH_SECRET: "test-secret-not-for-production-0123456789",
      AUTH_TEST_CURATORS: JSON.stringify([
        { email: "curator@pulse.test", name: "Test Curator", active: true, precinctId: "cbd", tier: "standard" },
      ]),
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
