import type { NextRequest } from "next/server";

// CLAUDE.md invariant 6: "Web sessions are anonymous rotating hashes." The
// cookie is httpOnly (never read by client JS) and expires after
// SESSION_HASH_MAX_AGE_SECONDS — once it lapses, middleware.ts mints a
// fresh, unrelated value, so the hash can't function as a long-lived
// identity even though it's stable enough to rate-limit a single evening's
// "this looks wrong" taps.
export const SESSION_HASH_COOKIE = "px_sh";
export const SESSION_HASH_MAX_AGE_SECONDS = 60 * 60 * 24;

// Route handlers read the cookie middleware.ts guarantees is set on every
// request that isn't a static asset. Returns null only for requests
// middleware never saw (shouldn't happen given its matcher), in which case
// the caller must treat the request as unidentifiable rather than fabricate
// a hash server-side.
export function readSessionHash(request: NextRequest): string | null {
  return request.cookies.get(SESSION_HASH_COOKIE)?.value ?? null;
}
