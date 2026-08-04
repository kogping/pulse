import { globalSingleton } from "./global-store";

// Storage abstraction for Auth.js database sessions and magic-link
// verification tokens — same rationale as curator-store.ts. Production uses
// the drizzle-backed store (packages/db authSessions / authVerificationTokens
// tables); e2e runs use an in-memory store under AUTH_TEST_MODE.
export interface SessionRecord {
  sessionToken: string;
  curatorId: string;
  expires: Date;
}

export interface VerificationTokenRecord {
  identifier: string;
  token: string;
  expires: Date;
}

export interface SessionStore {
  createSession(session: SessionRecord): Promise<void>;
  getSession(sessionToken: string): Promise<SessionRecord | null>;
  updateSessionExpiry(sessionToken: string, expires: Date): Promise<void>;
  deleteSession(sessionToken: string): Promise<void>;
  createVerificationToken(token: VerificationTokenRecord): Promise<void>;
  useVerificationToken(identifier: string, token: string): Promise<VerificationTokenRecord | null>;
}

function createDrizzleSessionStore(): SessionStore {
  return {
    async createSession(session) {
      const { db, authSessions } = await import("@pulse/db");
      await db.insert(authSessions).values(session);
    },
    async getSession(sessionToken) {
      const { db, authSessions } = await import("@pulse/db");
      const { eq } = await import("drizzle-orm");
      const rows = await db.select().from(authSessions).where(eq(authSessions.sessionToken, sessionToken)).limit(1);
      return rows[0] ?? null;
    },
    async updateSessionExpiry(sessionToken, expires) {
      const { db, authSessions } = await import("@pulse/db");
      const { eq } = await import("drizzle-orm");
      await db.update(authSessions).set({ expires }).where(eq(authSessions.sessionToken, sessionToken));
    },
    async deleteSession(sessionToken) {
      const { db, authSessions } = await import("@pulse/db");
      const { eq } = await import("drizzle-orm");
      await db.delete(authSessions).where(eq(authSessions.sessionToken, sessionToken));
    },
    async createVerificationToken(token) {
      const { db, authVerificationTokens } = await import("@pulse/db");
      await db.insert(authVerificationTokens).values(token);
    },
    async useVerificationToken(identifier, token) {
      const { db, authVerificationTokens } = await import("@pulse/db");
      const { and, eq } = await import("drizzle-orm");
      const rows = await db
        .select()
        .from(authVerificationTokens)
        .where(and(eq(authVerificationTokens.identifier, identifier), eq(authVerificationTokens.token, token)))
        .limit(1);
      if (!rows[0]) return null;
      await db
        .delete(authVerificationTokens)
        .where(and(eq(authVerificationTokens.identifier, identifier), eq(authVerificationTokens.token, token)));
      return rows[0];
    },
  };
}

function createInMemorySessionStore(): SessionStore {
  const sessions = globalSingleton("test-sessions", () => new Map<string, SessionRecord>());
  const tokens = globalSingleton("test-verification-tokens", () => new Map<string, VerificationTokenRecord>());
  const tokenKey = (identifier: string, token: string) => `${identifier}:${token}`;

  return {
    async createSession(session) {
      sessions.set(session.sessionToken, session);
    },
    async getSession(sessionToken) {
      return sessions.get(sessionToken) ?? null;
    },
    async updateSessionExpiry(sessionToken, expires) {
      const existing = sessions.get(sessionToken);
      if (existing) sessions.set(sessionToken, { ...existing, expires });
    },
    async deleteSession(sessionToken) {
      sessions.delete(sessionToken);
    },
    async createVerificationToken(token) {
      tokens.set(tokenKey(token.identifier, token.token), token);
    },
    async useVerificationToken(identifier, token) {
      const key = tokenKey(identifier, token);
      const record = tokens.get(key);
      if (!record) return null;
      tokens.delete(key);
      return record;
    },
  };
}

export const sessionStore: SessionStore =
  process.env.AUTH_TEST_MODE === "1" ? createInMemorySessionStore() : createDrizzleSessionStore();
