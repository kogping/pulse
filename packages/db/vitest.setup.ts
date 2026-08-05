// packages/db/src/env.ts parses process.env at import time, so tests that
// import ./index (directly or transitively) need valid-shaped values to
// avoid every test file blowing up in module setup. These are unreachable
// placeholders — no test in this package makes a real network call.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.UPSTASH_REDIS_REST_URL ??= "https://test.upstash.io";
process.env.UPSTASH_REDIS_REST_TOKEN ??= "test-token";
process.env.MAPBOX_TOKEN ??= "test-mapbox-token";
