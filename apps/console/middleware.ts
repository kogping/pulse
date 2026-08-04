import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Every route requires a session except /signin and /api/auth/* (invariant).
// This only checks for the session cookie's presence, not validity — the
// database-backed check (curator still active, session not expired) happens
// in the page itself via auth() (see app/queue/page.tsx), which needs the
// Node.js runtime for the DB driver. Middleware stays on the edge runtime
// and only does the cheap redirect for the fully-unauthenticated case.
const PUBLIC_PATHS = ["/signin"];
const SESSION_COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token"];

function isPublicPath(pathname: string) {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/api/auth/") ||
    // Test-only inbox introspection, inert outside AUTH_TEST_MODE (see
    // app/api/test/inbox/route.ts) — Playwright needs to read it while
    // unauthenticated, same as it needs /signin.
    pathname.startsWith("/api/test/") ||
    // Next.js's own static assets (JS chunks, etc.) — the matcher below is
    // "/:path*", which unlike Next's usual default matcher doesn't already
    // exclude these. Redirecting a chunk request to /signin serves HTML
    // where the browser expects JS, breaking hydration on every page.
    pathname.startsWith("/_next/")
  );
}

function hasSessionCookie(request: NextRequest) {
  return SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));
}

export function middleware(request: NextRequest) {
  const requiresSession = !isPublicPath(request.nextUrl.pathname) && !hasSessionCookie(request);
  const response = requiresSession
    ? NextResponse.redirect(new URL("/signin", request.url))
    : NextResponse.next();

  if (process.env.VERCEL_ENV !== "production") {
    response.headers.set("X-Robots-Tag", "noindex");
  }

  return response;
}

export const config = {
  matcher: "/:path*",
};
