import { randomUUID } from "node:crypto";
import { globalSingleton } from "./global-store";
import type { VenueInput, VenueSource } from "@pulse/db";

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
  photoUrl: string | null;
  hours: VenueHoursRecord[];
  attributes: VenueAttributeRecord[];
  // "google_places" means this venue was pre-seeded by scripts/places-import.ts
  // and has never been through a curator's create/update — see the edit page's
  // unclaimed-listing banner. Any save through this store (create or update)
  // sets it to "curator": editing through the console, which is curator-only,
  // is itself the act of claiming a listing, with no separate confirm step.
  source: VenueSource;
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

// Shared row -> record mappers, used by both getWithDetails (single venue)
// and listAll (every venue) so the two read paths can't drift on shape.
function toHoursRecord(row: {
  id: string;
  dayOfWeek: number;
  isClosed: boolean;
  opensAt: string | null;
  closesAt: string | null;
  kitchenClosesAt: string | null;
}): VenueHoursRecord {
  return {
    id: row.id,
    dayOfWeek: row.dayOfWeek,
    isClosed: row.isClosed,
    opensAt: row.opensAt,
    closesAt: row.closesAt,
    kitchenClosesAt: row.kitchenClosesAt,
  };
}

function toAttributeRecord(
  row: { id: string; attributeKey: string; value: string; lastVerifiedAt: Date; verifiedBy: string | null },
  verificationEventCount: number,
): VenueAttributeRecord {
  return {
    id: row.id,
    key: row.attributeKey,
    value: row.value,
    lastVerifiedAt: row.lastVerifiedAt,
    verifiedBy: row.verifiedBy,
    verificationEventCount,
  };
}

// Bumps the Redis feed-cache version for `precinct` after a venue_hours or
// venue_attributes write commits (see packages/db/src/feed-cache.ts and
// CLAUDE.md's Redis feed cache spec). Best-effort — a Redis outage here must
// never fail the curator's save; the console has no Sentry wiring of its own
// yet, so this logs to console.warn, matching the "log a warning and carry
// on" contract the cache itself follows.
async function invalidateFeedCache(precinct: string): Promise<void> {
  try {
    const { redis, bumpPrecinctFeedCacheVersion } = await import("@pulse/db");
    await bumpPrecinctFeedCacheVersion(redis, precinct);
  } catch (error) {
    console.warn(`[feed-cache] failed to invalidate precinct "${precinct}"`, error);
  }
}

// Onboarding-time transit hub linking (not per-request — see
// packages/db/src/hub-links.ts). Best-effort, same contract as
// invalidateFeedCache above: a PostGIS query failure or a Mapbox outage must
// never fail the curator's venue save, since computeVenueHubLinks already
// degrades a per-hub Mapbox failure to an estimated straight-line walk time
// rather than throwing — this catch only guards against the DB-level parts
// (finding candidate hubs, writing the link rows).
async function relinkVenueHubs(venueId: string, location: { lat: number; lng: number }): Promise<void> {
  try {
    const { linkVenueToNearestHubs } = await import("@pulse/db");
    await linkVenueToNearestHubs(venueId, location);
  } catch (error) {
    console.warn(`[hub-links] failed to link venue "${venueId}" to transit hubs`, error);
  }
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
          photoUrl: input.photoUrl ?? null,
          createdBy: curatorId,
          source: "curator",
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
      await invalidateFeedCache(input.precinct);
      await relinkVenueHubs(venueId, input.location);
      return { ok: true, venueId };
    },

    async update(venueId, input, curatorId) {
      const { db, venues, venueHours, venueAttributes, verificationEvents } = await import("@pulse/db");
      const { eq, sql } = await import("drizzle-orm");

      const existing = await db
        .select({
          id: venues.id,
          precinct: venues.precinct,
          createdBy: venues.createdBy,
          lat: sql<number>`ST_Y(${venues.location}::geometry)`,
          lng: sql<number>`ST_X(${venues.location}::geometry)`,
        })
        .from(venues)
        .where(eq(venues.id, venueId))
        .limit(1);
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
            photoUrl: input.photoUrl ?? null,
            // Saving through the console — curator-only — is the act of
            // claiming a listing: flips a scripts/places-import.ts venue to
            // "curator" with no separate confirm step. createdBy is
            // attribution-once (schema/venues.ts), so only backfilled here
            // if it was never set (a places-import venue has none).
            source: "curator",
            createdBy: existing[0]!.createdBy ?? curatorId,
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
      await invalidateFeedCache(input.precinct);
      if (existing[0]!.precinct !== input.precinct) await invalidateFeedCache(existing[0]!.precinct);

      // Recompute hub links only on an actual move, not every edit — a
      // ~0.11m tolerance absorbs the geography round-trip's float noise
      // without missing a real move.
      const LOCATION_UNCHANGED_TOLERANCE_DEGREES = 0.000001;
      const moved =
        Math.abs(existing[0]!.lat - input.location.lat) > LOCATION_UNCHANGED_TOLERANCE_DEGREES ||
        Math.abs(existing[0]!.lng - input.location.lng) > LOCATION_UNCHANGED_TOLERANCE_DEGREES;
      if (moved) await relinkVenueHubs(venueId, input.location);

      return { ok: true, venueId };
    },

    async getWithDetails(venueId) {
      const { db, venues, venueHours, venueAttributes, verificationEvents } = await import("@pulse/db");
      const { eq, inArray, sql } = await import("drizzle-orm");

      const [venue] = await db
        .select({
          id: venues.id,
          name: venues.name,
          precinct: venues.precinct,
          slug: venues.slug,
          address: venues.address,
          qualityTier: venues.qualityTier,
          curatorPitch: venues.curatorPitch,
          photoUrl: venues.photoUrl,
          source: venues.source,
          lat: sql<number>`ST_Y(${venues.location}::geometry)`,
          lng: sql<number>`ST_X(${venues.location}::geometry)`,
        })
        .from(venues)
        .where(eq(venues.id, venueId))
        .limit(1);
      if (!venue) return null;

      const hourRows = await db.select().from(venueHours).where(eq(venueHours.venueId, venueId));
      const attributeRows = await db.select().from(venueAttributes).where(eq(venueAttributes.venueId, venueId));
      // One grouped count query for every attribute on this venue, rather
      // than a verification_events round trip per attribute.
      const verificationCounts =
        attributeRows.length === 0
          ? []
          : await db
              .select({ venueAttributeId: verificationEvents.venueAttributeId, count: sql<number>`count(*)::int` })
              .from(verificationEvents)
              .where(
                inArray(
                  verificationEvents.venueAttributeId,
                  attributeRows.map((row) => row.id),
                ),
              )
              .groupBy(verificationEvents.venueAttributeId);
      const countByAttributeId = new Map(verificationCounts.map((c) => [c.venueAttributeId, c.count]));

      return {
        id: venue.id,
        name: venue.name,
        precinct: venue.precinct,
        slug: venue.slug,
        address: venue.address,
        location: { lat: venue.lat, lng: venue.lng },
        qualityTier: venue.qualityTier ?? "",
        curatorPitch: venue.curatorPitch ?? "",
        photoUrl: venue.photoUrl,
        source: venue.source as VenueSource,
        hours: hourRows.map(toHoursRecord),
        attributes: attributeRows.map((row) => toAttributeRecord(row, countByAttributeId.get(row.id) ?? 0)),
      };
    },

    async listAll() {
      const { db, venues, venueHours, venueAttributes, verificationEvents } = await import("@pulse/db");
      const { inArray, sql } = await import("drizzle-orm");

      const venueRows = await db
        .select({
          id: venues.id,
          name: venues.name,
          precinct: venues.precinct,
          slug: venues.slug,
          address: venues.address,
          qualityTier: venues.qualityTier,
          curatorPitch: venues.curatorPitch,
          photoUrl: venues.photoUrl,
          source: venues.source,
          lat: sql<number>`ST_Y(${venues.location}::geometry)`,
          lng: sql<number>`ST_X(${venues.location}::geometry)`,
        })
        .from(venues);
      if (venueRows.length === 0) return [];

      // Whole-table hours/attributes/verification-count reads, batched once
      // regardless of venue count — the previous version called
      // getWithDetails per venue, which itself issued a query per attribute,
      // for a total of O(venues x attributes) round trips.
      const venueIds = venueRows.map((v) => v.id);
      const [hourRows, attributeRows] = await Promise.all([
        db.select().from(venueHours).where(inArray(venueHours.venueId, venueIds)),
        db.select().from(venueAttributes).where(inArray(venueAttributes.venueId, venueIds)),
      ]);
      const attributeIds = attributeRows.map((row) => row.id);
      const verificationCounts =
        attributeIds.length === 0
          ? []
          : await db
              .select({ venueAttributeId: verificationEvents.venueAttributeId, count: sql<number>`count(*)::int` })
              .from(verificationEvents)
              .where(inArray(verificationEvents.venueAttributeId, attributeIds))
              .groupBy(verificationEvents.venueAttributeId);
      const countByAttributeId = new Map(verificationCounts.map((c) => [c.venueAttributeId, c.count]));

      const hoursByVenue = new Map<string, VenueHoursRecord[]>();
      for (const row of hourRows) {
        const list = hoursByVenue.get(row.venueId) ?? [];
        list.push(toHoursRecord(row));
        hoursByVenue.set(row.venueId, list);
      }
      const attributesByVenue = new Map<string, VenueAttributeRecord[]>();
      for (const row of attributeRows) {
        const list = attributesByVenue.get(row.venueId) ?? [];
        list.push(toAttributeRecord(row, countByAttributeId.get(row.id) ?? 0));
        attributesByVenue.set(row.venueId, list);
      }

      return venueRows.map((venue) => ({
        id: venue.id,
        name: venue.name,
        precinct: venue.precinct,
        slug: venue.slug,
        address: venue.address,
        location: { lat: venue.lat, lng: venue.lng },
        qualityTier: venue.qualityTier ?? "",
        curatorPitch: venue.curatorPitch ?? "",
        photoUrl: venue.photoUrl,
        source: venue.source as VenueSource,
        hours: hoursByVenue.get(venue.id) ?? [],
        attributes: attributesByVenue.get(venue.id) ?? [],
      }));
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
        photoUrl: input.photoUrl ?? null,
        source: "curator",
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
        photoUrl: input.photoUrl ?? null,
        source: "curator",
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
