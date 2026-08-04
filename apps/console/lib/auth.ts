import NextAuth, { type NextAuthResult } from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import { curatorStore, type CuratorRecord } from "./curator-store";
import { sessionStore } from "./session-store";
import { sendMagicLinkEmail } from "./email";

// 30-day rolling expiry: getSessionAndUser below pushes the expiry out on
// every validated access, so an active curator never gets signed out mid-use.
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const MAGIC_LINK_MAX_AGE_SECONDS = 24 * 60 * 60;

function toAdapterUser(curator: CuratorRecord): AdapterUser {
  return {
    id: curator.id,
    email: curator.email,
    name: curator.name,
    emailVerified: null,
    precinctId: curator.precinctId,
    tier: curator.tier,
    active: curator.active,
  };
}

// Custom Adapter over curator-store/session-store rather than
// @auth/drizzle-adapter: curators is our own domain identity table (not a
// generic Auth.js `users` table), and the stores are swappable so e2e tests
// don't need a live Neon database (see curator-store.ts / session-store.ts).
const adapter: Adapter = {
  async createUser() {
    // Curators are provisioned by INSERT (docs/runbook/curators.md), never
    // via self-service sign-up. Reachable only if the signIn callback's
    // allow-list check below is bypassed — refuse defensively.
    throw new Error("Self-service curator sign-up is disabled");
  },
  async getUser(id) {
    const curator = await curatorStore.findById(id);
    return curator ? toAdapterUser(curator) : null;
  },
  async getUserByEmail(email) {
    const curator = await curatorStore.findByEmail(email);
    return curator ? toAdapterUser(curator) : null;
  },
  async updateUser(user) {
    const curator = await curatorStore.findById(user.id);
    if (!curator) throw new Error(`Unknown curator ${user.id}`);
    return toAdapterUser(curator);
  },
  async linkAccount() {
    return undefined;
  },
  async createSession({ sessionToken, userId, expires }) {
    await sessionStore.createSession({ sessionToken, curatorId: userId, expires });
    return { sessionToken, userId, expires };
  },
  async getSessionAndUser(sessionToken) {
    const session = await sessionStore.getSession(sessionToken);
    if (!session) return null;
    if (session.expires.getTime() < Date.now()) {
      await sessionStore.deleteSession(sessionToken);
      return null;
    }
    const curator = await curatorStore.findById(session.curatorId);
    if (!curator || !curator.active) {
      await sessionStore.deleteSession(sessionToken);
      return null;
    }
    const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
    await sessionStore.updateSessionExpiry(sessionToken, expires);
    return {
      session: { sessionToken, userId: curator.id, expires },
      user: toAdapterUser(curator),
    };
  },
  async updateSession({ sessionToken, expires }) {
    if (expires) await sessionStore.updateSessionExpiry(sessionToken, expires);
    const session = await sessionStore.getSession(sessionToken);
    return session ? { sessionToken: session.sessionToken, userId: session.curatorId, expires: session.expires } : null;
  },
  async deleteSession(sessionToken) {
    await sessionStore.deleteSession(sessionToken);
  },
  async createVerificationToken(token) {
    await sessionStore.createVerificationToken(token);
    return token;
  },
  async useVerificationToken({ identifier, token }) {
    return sessionStore.useVerificationToken(identifier, token);
  },
};

const nextAuth: NextAuthResult = NextAuth({
  adapter,
  session: { strategy: "database", maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: "/signin" },
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  providers: [
    Nodemailer({
      // Unused: sendVerificationRequest below fully replaces delivery, so no
      // SMTP transport is ever constructed. A `server` value is required
      // only to satisfy the provider factory's own validation.
      server: { host: "localhost", port: 25 },
      from: process.env.AUTH_EMAIL_FROM ?? "Pulse Sydney Console <console@pulse.sydney>",
      maxAge: MAGIC_LINK_MAX_AGE_SECONDS,
      async sendVerificationRequest({ identifier, url }) {
        await sendMagicLinkEmail({ to: identifier, url });
      },
    }),
  ],
  callbacks: {
    // Defense in depth: the sign-in server action (app/signin/actions.ts)
    // already gates on the allow-list before ever calling signIn(), but this
    // callback re-checks so the invariant holds even if something calls
    // next-auth's signIn() directly.
    async signIn({ user }) {
      if (!user.email) return false;
      const curator = await curatorStore.findByEmail(user.email);
      return Boolean(curator?.active);
    },
    // The default redirect callback resolves `baseUrl` from request headers,
    // which under `next dev` can disagree between the sign-in request (host
    // 127.0.0.1) and the callback request (host localhost), sending curators
    // to the wrong origin after clicking the magic link. We only ever pass
    // relative redirectTo values ourselves (see app/signin/actions.ts), so
    // trust those as-is and otherwise fall back to baseUrl.
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return url;
      try {
        if (new URL(url).origin === new URL(baseUrl).origin) return url;
      } catch {
        // fall through to baseUrl
      }
      return baseUrl;
    },
    async session({ session, user }) {
      return {
        ...session,
        curatorId: user.id,
        precinctId: user.precinctId,
        tier: user.tier,
      };
    },
  },
});

export const handlers: NextAuthResult["handlers"] = nextAuth.handlers;
export const auth: NextAuthResult["auth"] = nextAuth.auth;
export const signIn: NextAuthResult["signIn"] = nextAuth.signIn;
export const signOut: NextAuthResult["signOut"] = nextAuth.signOut;
