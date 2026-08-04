import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./client";
import { curators, venueAttributes, venues } from "./schema";
import { attributeConfidence } from "./freshness";

// The shared read layer for venue attributes shown outside the curator
// console (F2.4). This is the ONLY exported shape in this file that carries
// an attribute value — getVenueForCard and getFeedVenues return exclusively
// this union, never the base venue_attributes row. See freshness.ts for the
// curator-facing QueueAttributeSnapshot, which is deliberately a different
// (always-value-bearing) shape for the opposite reason: a curator needs to
// see the unconfirmed value to re-verify it.
export type AttributeValue = string;

export type AttributeView =
  | {
      key: string;
      value: AttributeValue;
      confidence: "fresh" | "ageing";
      lastVerifiedAt: Date;
      verifiedBy: { curatorId: string; name: string; tier: string };
    }
  | { key: string; confidence: "unconfirmed" };

const verifiedBySchema = z
  .object({
    curatorId: z.string(),
    name: z.string(),
    tier: z.string(),
  })
  .strict();

function valueBearingSchema(confidence: "fresh" | "ageing") {
  return z
    .object({
      key: z.string(),
      value: z.string(),
      confidence: z.literal(confidence),
      lastVerifiedAt: z.date(),
      verifiedBy: verifiedBySchema,
    })
    .strict();
}

// Mirrors AttributeView exactly, including .strict() on every branch so a
// stray extra key (e.g. a leaked raw column) fails validation rather than
// passing silently.
export const attributeViewSchema = z.discriminatedUnion("confidence", [
  valueBearingSchema("fresh"),
  valueBearingSchema("ageing"),
  z.object({ key: z.string(), confidence: z.literal("unconfirmed") }).strict(),
]);

// Row shape produced by the queries below: one venue_attributes row left-
// joined to its verifying curator, with the 24h flag count needed by
// attributeConfidence(). Kept separate from AttributeView so the confidence
// computation and the curator-identity lookup can be unit tested against
// plain fixture data, without a database.
export interface AttributeViewRow {
  venueId: string;
  attributeKey: string;
  value: string;
  lastVerifiedAt: Date;
  flagCount: number;
  verifiedByCuratorId: string | null;
  verifiedByName: string | null;
  verifiedByTier: string | null;
}

// Pure mapping step, no I/O — this is what the contract test runs against
// seed-shaped fixture rows.
export function buildAttributeView(row: AttributeViewRow, now: Date): AttributeView {
  const confidence = attributeConfidence({
    attributeKey: row.attributeKey,
    lastVerifiedAt: row.lastVerifiedAt,
    flagCount: row.flagCount,
    now,
  });
  if (confidence === "unconfirmed") return { key: row.attributeKey, confidence };

  // If the curator who last verified this has since been removed
  // (verified_by -> null on delete, see schema/venue-attributes.ts), there
  // is no one left to attest the value's provenance. Degrade to
  // unconfirmed rather than show a value with no verifiedBy — same
  // "silence beats a confident wrong number" principle as freshness.ts.
  if (!row.verifiedByCuratorId || !row.verifiedByName || !row.verifiedByTier) {
    return { key: row.attributeKey, confidence: "unconfirmed" };
  }

  return {
    key: row.attributeKey,
    value: row.value,
    confidence,
    lastVerifiedAt: row.lastVerifiedAt,
    verifiedBy: {
      curatorId: row.verifiedByCuratorId,
      name: row.verifiedByName,
      tier: row.verifiedByTier,
    },
  };
}

export interface VenueCardData {
  id: string;
  name: string;
  precinct: string;
  attributes: AttributeView[];
}

// Pure grouping/mapping step, no I/O.
export function buildVenueCard(
  venue: { id: string; name: string; precinct: string },
  attributeRows: AttributeViewRow[],
  now: Date,
): VenueCardData {
  return {
    id: venue.id,
    name: venue.name,
    precinct: venue.precinct,
    attributes: attributeRows.filter((row) => row.venueId === venue.id).map((row) => buildAttributeView(row, now)),
  };
}

async function fetchAttributeViewRows(venueIds: string[]): Promise<AttributeViewRow[]> {
  if (venueIds.length === 0) return [];
  return db
    .select({
      venueId: venueAttributes.venueId,
      attributeKey: venueAttributes.attributeKey,
      value: venueAttributes.value,
      lastVerifiedAt: venueAttributes.lastVerifiedAt,
      // Mirrors the flag-count-in-last-24h window used by
      // venue_attributes_resolved (migration 0001) and nextQueueBatch
      // (queue.ts) — kept in sync by hand since neither Drizzle table nor
      // this correlated subquery can share SQL with the view directly.
      flagCount: sql<number>`(
        select count(*)::int from correction_flags cf
        where cf.venue_attribute_id = ${venueAttributes.id}
          and cf.flagged_at >= now() - interval '24 hours'
      )`,
      verifiedByCuratorId: curators.id,
      verifiedByName: curators.name,
      verifiedByTier: curators.tier,
    })
    .from(venueAttributes)
    .leftJoin(curators, eq(curators.id, venueAttributes.verifiedBy))
    .where(inArray(venueAttributes.venueId, venueIds));
}

// The public read path for one venue's card. Returns null if the venue
// doesn't exist; otherwise every attribute is shaped as AttributeView —
// there is no way to reach into venue_attributes from this function's
// return value.
export async function getVenueForCard(venueId: string): Promise<VenueCardData | null> {
  const [venue] = await db
    .select({ id: venues.id, name: venues.name, precinct: venues.precinct })
    .from(venues)
    .where(eq(venues.id, venueId))
    .limit(1);
  if (!venue) return null;

  const attributeRows = await fetchAttributeViewRows([venueId]);
  return buildVenueCard(venue, attributeRows, new Date());
}

export interface GetFeedVenuesParams {
  precinct?: string;
  limit?: number;
}

// The public read path for a feed page: every venue (optionally filtered to
// one precinct), each with its attributes shaped as AttributeView.
export async function getFeedVenues(params: GetFeedVenuesParams = {}): Promise<VenueCardData[]> {
  const { precinct, limit = 20 } = params;

  const venueRows = await db
    .select({ id: venues.id, name: venues.name, precinct: venues.precinct })
    .from(venues)
    .where(precinct ? eq(venues.precinct, precinct) : undefined)
    .limit(limit);
  if (venueRows.length === 0) return [];

  const attributeRows = await fetchAttributeViewRows(venueRows.map((v) => v.id));
  const now = new Date();
  return venueRows.map((venue) => buildVenueCard(venue, attributeRows, now));
}

// Dev/test-only guard: throws with a readable diff-style message the first
// time an AttributeView fails schema validation, so a shape violation is
// caught at the point it's produced rather than surfacing as a rendering
// bug downstream. A no-op in production (never throw at users because of a
// validation helper).
export function assertValidAttributeViews(attributes: readonly AttributeView[]): void {
  if (process.env.NODE_ENV === "production") return;
  for (const attribute of attributes) {
    const result = attributeViewSchema.safeParse(attribute);
    if (!result.success) {
      throw new Error(`Invalid AttributeView for key "${attribute.key}": ${result.error.message}`);
    }
  }
}
