// Session shape per CLAUDE.md: { curatorId, precinctId, tier }. No roles
// system — these are the only fields curator-facing code should read.
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    curatorId: string;
    precinctId: string | null;
    tier: string;
  }
}

declare module "next-auth/adapters" {
  interface AdapterUser {
    precinctId: string | null;
    tier: string;
    active: boolean;
  }
}
