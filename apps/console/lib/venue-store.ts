import { randomUUID } from "node:crypto";
import { globalSingleton } from "./global-store";
import type { VenueInput } from "@pulse/db";

// Storage abstraction for venue create/edit — same rationale as
// curator-store.ts/session-store.ts: production goes through Drizzle/Neon,
// vitest and Playwright run against an in-memory store under AUTH_TEST_MODE
// so neither needs a live database.
export interface VenueAttributeRecord {
  id: string;
  key: string;
  value: string;
  lastVerifiedAt: Date;
  verifiedBy: string | null;
  // Count of verification_events rows for this attribute — exposed here
  // purely so tests can assert "one verification_events row per attribute"
  // without a second round-trip.
  verificationEventCount: number;
}

export interface VenueHoursRecord {
  id: string;
  dayOfWeek: number;
  isClosed: boolean;
  opensAt: string | null;
  closesAt: string | null;
  kitchenClosesAt: string | null;
}

export interface VenueDetailRecord {
  id: string;
  name: string;
  precinct: string;
  slug: string;
  address: string | null;
  location: { lat: number; lng: number };
  qualityTier: string;
  curatorPitch: string;
  hours: VenueHoursRecord[];
  attributes: VenueAttributeRecord[];
}

export type VenueWriteOutcome =
  | { ok: true; venueId: string }
  | { ok: false; reason: "duplicate_slug" }
  | { ok: false; reason: "not_found" };

export interface VenueStore {
  create(input: VenueInput, curatorId: string): Promise<VenueWriteOutcome>;
  update(venueId: string, input: VenueInput, curatorId: string): Promise<VenueWriteOutcome>;
  getWithDetails(venueId: string): Promise<VenueDetailRecord | null>;
  listAll(): Promise<VenueDetailRecord[]>;
}

function createDrizzleVenueStore(): VenueStore {
  async function slugTaken(precinct: string, slug: string, excludeVenueId?: string): Promise<boolean> {
    const { db, venues } = await import("@pulse/db");
    const { and, eq, ne } = await import("drizzle-orm");
    const conditions = [eq(venues.precinct, precinct), eq(venues.slug, slug)];
    if (excludeVenueId) conditions.push(ne(venues.id, excludeVenueId));
    const rows = await db
      .select({ id: venues.id })
      .from(venues)
      .where(and(...conditions))
      .limit(1);
    return rows.length > 0;
  }

  return {
    async create(input, curatorId) {
      const { db, venues, venueHours, venueAttributes, verificationEvents } = await import("@pulse/db");
      const { sql } = await import("drizzle-orm");

      if (await slugTaken(input.precinct, input.slug)) return { ok: false, reason: "duplicate_slug" };

      const venueId = randomUUID();
      // neon-http has no interactive transactions (drizzle throws "No
      // transactions support in neon-http driver" on db.transaction()), so
      // atomicity here comes from db.batch(), which sends every statement as
      // one Neon batch RPC. IDs are generated client-side (rather than
      // relying on defaultRandom()) so later statements in the batch can
      // reference IDs produced by earlier ones.
      type BatchQuery = Parameters<typeof db.batch>[0][number];
      const queries: BatchQuery[] = [
        db.insert(venues).values({
          id: venueId,
          precinct: input.precinct,
          name: input.name,
          slug: input.slug,
          address: input.address ?? null,
          qualityTier: input.qualityTier,
          curatorPitch: input.curatorPitch,
          location: sql`ST_SetSRID(ST_MakePoint(${input.location.lng}, ${input.location.lat}), 4326)::geography`,
        }),
      ];
      for (const hour of input.hours) {
        queries.push(
          db.insert(venueHours).values({
            venueId,
            dayOfWeek: hour.dayOfWeek,
            isClosed: hour.isClosed,
            opensAt: hour.opensAt,
            closesAt: hour.closesAt,
            kitchenClosesAt: hour.kitchenClosesAt ?? null,
          }),
        );
      }
      for (const attribute of input.attributes) {
        const attributeId = randomUUID();
        queries.push(
          db.insert(venueAttributes).values({
            id: attributeId,
            venueId,
            attributeKey: attribute.key,
            value: attribute.value,
            verifiedBy: curatorId,
          }),
        );
        queries.push(db.insert(verificationEvents).values({ venueAttributeId: attributeId, curatorId }));
      }
      await db.batch(queries as [BatchQuery, ...BatchQuery[]]);
      return { ok: true, venueId };
    },

    async update(venueId, input, curatorId) {
      const { db, venues, venueHours, venueAttributes, verificationEvents } = await import("@pulse/db");
      const { eq, sql } = await import("drizzle-orm");

      const existing = await db.select({ id: venues.id }).from(venues).where(eq(venues.id, venueId)).limit(1);
      if (existing.length === 0) return { ok: false, reason: "not_found" };
      if (await slugTaken(input.precinct, input.slug, venueId)) return { ok: false, reason: "duplicate_slug" };

      const existingAttributes = await db
        .select({ id: venueAttributes.id, key: venueAttributes.attributeKey })
        .from(venueAttributes)
        .where(eq(venueAttributes.venueId, venueId));
      const existingAttributeIdByKey = new Map(existingAttributes.map((a) => [a.key, a.id]));

      await db.delete(venueHours).where(eq(venueHours.venueId, venueId));

      type BatchQuery = Parameters<typeof db.batch>[0][number];
      const queries: BatchQuery[] = [
        db
          .update(venues)
          .set({
            precinct: input.precinct,
            name: input.name,
            slug: input.slug,
            address: input.address ?? null,
            qualityTier: input.qualityTier,
            curatorPitch: input.curatorPitch,
            location: sql`ST_SetSRID(ST_MakePoint(${input.location.lng}, ${input.location.lat}), 4326)::geography`,
            updatedAt: new Date(),
          })
          .where(eq(venues.id, venueId)),
      ];
      for (const hour of input.hours) {
        queries.push(
          db.insert(venueHours).values({
            venueId,
            dayOfWeek: hour.dayOfWeek,
            isClosed: hour.isClosed,
            opensAt: hour.opensAt,
            closesAt: hour.closesAt,
            kitchenClosesAt: hour.kitchenClosesAt ?? null,
          }),
        );
      }
      for (const attribute of input.attributes) {
        const existingId = existingAttributeIdByKey.get(attribute.key);
        const attributeId = existingId ?? randomUUID();
        if (existingId) {
          queries.push(
            db
              .update(venueAttributes)
              .set({ value: attribute.value, lastVerifiedAt: new Date(), verifiedBy: curatorId })
              .where(eq(venueAttributes.id, attributeId)),
          );
        } else {
          queries.push(
            db.insert(venueAttributes).values({
              id: attributeId,
              venueId,
              attributeKey: attribute.key,
              value: attribute.value,
              verifiedBy: curatorId,
            }),
          );
        }
        queries.push(db.insert(verificationEvents).values({ venueAttributeId: attributeId, curatorId }));
      }
      await db.batch(queries as [BatchQuery, ...BatchQuery[]]);
      return { ok: true, venueId };
    },

    async getWithDetails(venueId) {
      const { db, venues, venueHours, venueAttributes, verificationEvents } = await import("@pulse/db");
      const { eq, sql } = await import("drizzle-orm");

      const [venue] = await db
        .select({
          id: venues.id,
          name: venues.name,
          precinct: venues.precinct,
          slug: venues.slug,
          address: venues.address,
          qualityTier: venues.qualityTier,
          curatorPitch: venues.curatorPitch,
          lat: sql<number>`ST_Y(${venues.location}::geometry)`,
          lng: sql<number>`ST_X(${venues.location}::geometry)`,
        })
        .from(venues)
        .where(eq(venues.id, venueId))
        .limit(1);
      if (!venue) return null;

      const hourRows = await db.select().from(venueHours).where(eq(venueHours.venueId, venueId));
      const attributeRows = await db.select().from(venueAttributes).where(eq(venueAttributes.venueId, venueId));
      const attributes: VenueAttributeRecord[] = [];
      for (const row of attributeRows) {
        const [countRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(verificationEvents)
          .where(eq(verificationEvents.venueAttributeId, row.id));
        const count = countRow?.count ?? 0;
        attributes.push({
          id: row.id,
          key: row.attributeKey,
          value: row.value,
          lastVerifiedAt: row.lastVerifiedAt,
          verifiedBy: row.verifiedBy,
          verificationEventCount: count,
        });
      }

      return {
        id: venue.id,
        name: venue.name,
        precinct: venue.precinct,
        slug: venue.slug,
        address: venue.address,
        location: { lat: venue.lat, lng: venue.lng },
        qualityTier: venue.qualityTier ?? "",
        curatorPitch: venue.curatorPitch ?? "",
        hours: hourRows.map((h) => ({
          id: h.id,
          dayOfWeek: h.dayOfWeek,
          isClosed: h.isClosed,
          opensAt: h.opensAt,
          closesAt: h.closesAt,
          kitchenClosesAt: h.kitchenClosesAt,
        })),
        attributes,
      };
    },

    async listAll() {
      const { db, venues } = await import("@pulse/db");
      const rows = await db.select({ id: venues.id }).from(venues);
      const details = await Promise.all(rows.map((r) => this.getWithDetails(r.id)));
      return details.filter((d): d is VenueDetailRecord => d !== null);
    },
  };
}

function createInMemoryVenueStore(): VenueStore {
  const venues = globalSingleton("test-venues", () => new Map<string, VenueDetailRecord>());

  function slugTaken(precinct: string, slug: string, excludeVenueId?: string): boolean {
    for (const venue of venues.values()) {
      if (venue.id !== excludeVenueId && venue.precinct === precinct && venue.slug === slug) return true;
    }
    return false;
  }

  function toHours(input: VenueInput["hours"]): VenueHoursRecord[] {
    return input.map((h) => ({
      id: randomUUID(),
      dayOfWeek: h.dayOfWeek,
      isClosed: h.isClosed,
      opensAt: h.opensAt,
      closesAt: h.closesAt,
      kitchenClosesAt: h.kitchenClosesAt ?? null,
    }));
  }

  return {
    async create(input, curatorId) {
      if (slugTaken(input.precinct, input.slug)) return { ok: false, reason: "duplicate_slug" };

      const id = randomUUID();
      const attributes: VenueAttributeRecord[] = input.attributes.map((a) => ({
        id: randomUUID(),
        key: a.key,
        value: a.value,
        lastVerifiedAt: new Date(),
        verifiedBy: curatorId,
        verificationEventCount: 1,
      }));
      venues.set(id, {
        id,
        name: input.name,
        precinct: input.precinct,
        slug: input.slug,
        address: input.address ?? null,
        location: input.location,
        qualityTier: input.qualityTier,
        curatorPitch: input.curatorPitch,
        hours: toHours(input.hours),
        attributes,
      });
      return { ok: true, venueId: id };
    },

    async update(venueId, input, curatorId) {
      const existing = venues.get(venueId);
      if (!existing) return { ok: false, reason: "not_found" };
      if (slugTaken(input.precinct, input.slug, venueId)) return { ok: false, reason: "duplicate_slug" };

      const existingByKey = new Map(existing.attributes.map((a) => [a.key, a]));
      const attributes: VenueAttributeRecord[] = input.attributes.map((a) => {
        const prior = existingByKey.get(a.key);
        return prior
          ? {
              ...prior,
              value: a.value,
              lastVerifiedAt: new Date(),
              verifiedBy: curatorId,
              verificationEventCount: prior.verificationEventCount + 1,
            }
          : {
              id: randomUUID(),
              key: a.key,
              value: a.value,
              lastVerifiedAt: new Date(),
              verifiedBy: curatorId,
              verificationEventCount: 1,
            };
      });

      venues.set(venueId, {
        id: venueId,
        name: input.name,
        precinct: input.precinct,
        slug: input.slug,
        address: input.address ?? null,
        location: input.location,
        qualityTier: input.qualityTier,
        curatorPitch: input.curatorPitch,
        hours: toHours(input.hours),
        attributes,
      });
      return { ok: true, venueId };
    },

    async getWithDetails(venueId) {
      return venues.get(venueId) ?? null;
    },

    async listAll() {
      return [...venues.values()];
    },
  };
}

export const venueStore: VenueStore =
  process.env.AUTH_TEST_MODE === "1" ? createInMemoryVenueStore() : createDrizzleVenueStore();
