// Runs before any test file's imports, so the curator/session/venue stores
// (which pick in-memory vs. Drizzle-backed at module-eval time on this same
// flag — see lib/venue-store.ts) resolve to the in-memory implementation
// before vitest tests ever touch them. No live Neon database needed.
process.env.AUTH_TEST_MODE ??= "1";
