import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

// Test-only session mint, deliberately decoupled from AUTH_TEST_MODE: this
// route exists so an e2e spec can sign in as a curator while curator-store,
// session-store, and queue-store all take their normal Drizzle-backed
// production path (reachable whenever AUTH_TEST_MODE is unset) against a
// real seeded Postgres — needed for flag-roundtrip.spec.ts, which writes a
// real correction_flags row from apps/web and must see it through the
// console's real queue query (nextQueueBatch), not the in-memory fixture
// AUTH_TEST_MODE swaps in for queue.spec.ts et al.
//
// 404s unless E2E_LIVE_SESSION_TEST_MODE is set, same convention as
// app/api/test/inbox and app/api/test/queue-seed (which gate on
// AUTH_TEST_MODE instead, since they exist to avoid a live database, the
// opposite of what this route is for). middleware.ts already allow-lists
// /api/test/.
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export async function POST(request: Request) {
  if (process.env.E2E_LIVE_SESSION_TEST_MODE !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    name?: string;
    precinctId?: string;
  };
  const email = body.email ?? "e2e-live-curator@pulse.test";
  const name = body.name ?? "E2E Live Curator";
  const precinctId = body.precinctId ?? "cbd";

  const { db, curators, authSessions } = await import("@pulse/db");
  const { eq } = await import("drizzle-orm");

  const [existing] = await db.select({ id: curators.id }).from(curators).where(eq(curators.email, email)).limit(1);

  let curatorId = existing?.id;
  if (curatorId) {
    await db.update(curators).set({ name, active: true, precinctId, tier: "standard" }).where(eq(curators.id, curatorId));
  } else {
    const [inserted] = await db
      .insert(curators)
      .values({ email, name, active: true, precinctId, tier: "standard" })
      .returning({ id: curators.id });
    curatorId = inserted!.id;
  }

  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await db.insert(authSessions).values({ sessionToken, curatorId, expires });

  const response = NextResponse.json({ ok: true, curatorId });
  // Unprefixed cookie name matches what Auth.js issues over plain http in
  // dev (see middleware.ts's SESSION_COOKIE_NAMES) — e2e runs against
  // `next dev` on 127.0.0.1, never https, so the `__Secure-` variant never
  // applies here.
  response.cookies.set("authjs.session-token", sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires,
  });
  return response;
}
