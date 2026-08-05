import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { correctionFlags, venueAttributes, venues } from "./schema";

export interface InsertCorrectionFlagInput {
  venueId: string;
  attributeKey: string;
  reporterSessionHash: string;
  reason?: string;
}

export type InsertCorrectionFlagResult = { ok: true; precinct: string } | { ok: false; reason: "not_found" };

// Public "this looks wrong" write path (F3.x). Confidence is never touched
// here — it's a pure function of (attribute_key, last_verified_at,
// flag_count, now()) read at query time (venue_attributes_resolved,
// freshness.ts), so a bare insert is the entire effect. The caller
// (apps/web/app/api/flag) owns rate limiting; this function does not
// enforce it, so it must never be reachable from anywhere the caller's
// limit hasn't already been checked.
export async function insertCorrectionFlag(input: InsertCorrectionFlagInput): Promise<InsertCorrectionFlagResult> {
  const [attribute] = await db
    .select({ id: venueAttributes.id, precinct: venues.precinct })
    .from(venueAttributes)
    .innerJoin(venues, eq(venues.id, venueAttributes.venueId))
    .where(and(eq(venueAttributes.venueId, input.venueId), eq(venueAttributes.attributeKey, input.attributeKey)))
    .limit(1);

  if (!attribute) return { ok: false, reason: "not_found" };

  await db.insert(correctionFlags).values({
    venueAttributeId: attribute.id,
    reporterSessionHash: input.reporterSessionHash,
    reason: input.reason,
  });

  return { ok: true, precinct: attribute.precinct };
}
