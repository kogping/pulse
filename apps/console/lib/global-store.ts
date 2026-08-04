// Next.js dev compiles Server Actions, Route Handlers, and Middleware as
// separate module graphs, so a plain module-level `const store = []` gets a
// distinct instance per graph even though it's the same Node.js process —
// e.g. a magic-link token created while handling the sign-in Server Action
// would be invisible to the /api/auth/callback Route Handler that redeems
// it. Anchoring test-mode in-memory state on `globalThis` (the one thing
// actually shared across all of them) avoids that split. Only used behind
// AUTH_TEST_MODE — production always goes through packages/db.
export function globalSingleton<T>(key: string, create: () => T): T {
  const bucket = globalThis as unknown as Record<string, T | undefined>;
  const globalKey = `__pulse_console_${key}__`;
  bucket[globalKey] ??= create();
  return bucket[globalKey] as T;
}
