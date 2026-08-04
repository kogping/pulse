import { globalSingleton } from "./global-store";

// Storage abstraction for curator identities, so the auth flow (allow-list
// gate, session shape) can be exercised in Playwright without a live Neon
// database. Production always uses the drizzle-backed store; e2e runs opt
// into the in-memory store via AUTH_TEST_MODE, seeded from AUTH_TEST_CURATORS
// (see playwright.config.ts).
export interface CuratorRecord {
  id: string;
  email: string;
  name: string;
  active: boolean;
  precinctId: string | null;
  tier: string;
}

export interface CuratorStore {
  findByEmail(email: string): Promise<CuratorRecord | null>;
  findById(id: string): Promise<CuratorRecord | null>;
}

function createDrizzleCuratorStore(): CuratorStore {
  return {
    async findByEmail(email) {
      const { db, curators } = await import("@pulse/db");
      const { eq } = await import("drizzle-orm");
      const rows = await db.select().from(curators).where(eq(curators.email, email)).limit(1);
      return rows[0] ? toRecord(rows[0]) : null;
    },
    async findById(id) {
      const { db, curators } = await import("@pulse/db");
      const { eq } = await import("drizzle-orm");
      const rows = await db.select().from(curators).where(eq(curators.id, id)).limit(1);
      return rows[0] ? toRecord(rows[0]) : null;
    },
  };
}

function toRecord(row: {
  id: string;
  email: string;
  name: string;
  active: boolean;
  precinctId: string | null;
  tier: string;
}): CuratorRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    active: row.active,
    precinctId: row.precinctId,
    tier: row.tier,
  };
}

interface TestCuratorSeed {
  id?: string;
  email: string;
  name?: string;
  active?: boolean;
  precinctId?: string | null;
  tier?: string;
}

function createInMemoryCuratorStore(): CuratorStore {
  const records = globalSingleton("test-curators", () => {
    const raw = process.env.AUTH_TEST_CURATORS ?? "[]";
    const seed: TestCuratorSeed[] = JSON.parse(raw);
    return seed.map(
      (c, i): CuratorRecord => ({
        id: c.id ?? `test-curator-${i}`,
        email: c.email,
        name: c.name ?? c.email,
        active: c.active ?? true,
        precinctId: c.precinctId ?? null,
        tier: c.tier ?? "standard",
      }),
    );
  });

  return {
    async findByEmail(email) {
      return records.find((r) => r.email === email) ?? null;
    },
    async findById(id) {
      return records.find((r) => r.id === id) ?? null;
    },
  };
}

export const curatorStore: CuratorStore =
  process.env.AUTH_TEST_MODE === "1" ? createInMemoryCuratorStore() : createDrizzleCuratorStore();
