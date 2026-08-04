import { eq, sql } from "drizzle-orm";
import { db } from "./client";
import { venueAttributes } from "./schema";
import { attributeConfidence, type ResolvedVenueAttribute } from "./freshness";

// The public read path for a single attribute: whatever venue_attributes
// currently holds, run through the same confidence function as
// venue_attributes_resolved (freshness.sql.ts). A pending_edits row never
// touches venue_attributes until approved, so this — and everything else
// reading this table — keeps returning the pre-edit value for the whole
// time an edit is awaiting a second curator's approval.
export async function resolvePublicAttribute(venueAttributeId: string): Promise<ResolvedVenueAttribute | null> {
  const [row] = await db
    .select({
      attributeKey: venueAttributes.attributeKey,
      value: venueAttributes.value,
      lastVerifiedAt: venueAttributes.lastVerifiedAt,
      flagCount: sql<number>`(
        select count(*)::int from correction_flags cf
        where cf.venue_attribute_id = ${venueAttributes.id}
          and cf.flagged_at >= now() - interval '24 hours'
      )`,
    })
    .from(venueAttributes)
    .where(eq(venueAttributes.id, venueAttributeId))
    .limit(1);
  if (!row) return null;

  const confidence = attributeConfidence({
    attributeKey: row.attributeKey,
    lastVerifiedAt: row.lastVerifiedAt,
    flagCount: row.flagCount,
    now: new Date(),
  });
  if (confidence === "unconfirmed") return { confidence };
  return { confidence, value: row.value, lastVerifiedAt: row.lastVerifiedAt };
}
