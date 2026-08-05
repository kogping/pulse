import { NextResponse, type NextRequest } from "next/server";
import { SESSION_HASH_COOKIE, SESSION_HASH_MAX_AGE_SECONDS } from "./lib/session";

// Mints the anonymous rotating session hash (CLAUDE.md invariant 6) that
// /api/flag rate-limits and stamps correction_flags.reporter_session_hash
// with. httpOnly + no identity fields means it never carries anything
// beyond "same browser, same rotation window" — see lib/session.ts.
export function middleware(request: NextRequest) {
  if (request.cookies.has(SESSION_HASH_COOKIE)) return NextResponse.next();

  const response = NextResponse.next();
  response.cookies.set(SESSION_HASH_COOKIE, crypto.randomUUID(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HASH_MAX_AGE_SECONDS,
  });
  return response;
}

export const config = {
  // Everything except Next's static assets and the PWA files served
  // straight out of /public — a rotating cookie has nothing to do for a
  // request that never reaches a route handler.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js).*)"],
};
