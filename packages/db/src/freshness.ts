// Single source of truth for freshness decay rules.
//
// Confidence is NEVER stored — it's derived at read time from
// (attribute_key, last_verified_at, flag_count, now()). This file is the
// canonical TypeScript implementation; migrations/0001_attribute_confidence.sql
// contains a SQL port that must produce identical results. The two are kept
// in lockstep by scripts/generate-freshness-sql.ts, which renders the SQL
// CASE expression straight out of ATTRIBUTE_CLASSES/DECAY_RULES below —
// freshness.test.ts fails if the checked-in migration ever drifts from a
// fresh render of this table.
export type Confidence = "fresh" | "ageing" | "unconfirmed";

// Shape returned by any API exposing a venue attribute (backed by the
// venue_attributes_resolved view). A discriminated union so it's a type
// error, not just a convention, to read `.value` off an unconfirmed
// attribute — there is no such value to show.
export type ResolvedVenueAttribute =
  | { confidence: "fresh" | "ageing"; value: string; lastVerifiedAt: Date }
  | { confidence: "unconfirmed" };

export type AttributeClass = "realtime" | "nightly" | "static";

// How quickly each class of attribute goes stale without re-verification.
export const DECAY_RULES: Record<AttributeClass, { freshHours: number; ageingHours: number }> = {
  // Changes minute to minute: queue length, crowd level.
  realtime: { freshHours: 2, ageingHours: 6 },
  // Set for the night and rarely changes mid-service: cover charge, live
  // music, dress-code enforcement tonight.
  nightly: { freshHours: 12, ageingHours: 36 },
  // Changes on the order of months: price tier, wheelchair access, outdoor
  // area, standard dress code.
  static: { freshHours: 24 * 30, ageingHours: 24 * 120 },
};

// attribute_key -> class. Keys not listed here fall back to DEFAULT_CLASS.
export const ATTRIBUTE_CLASSES: Record<string, AttributeClass> = {
  queue_length: "realtime",
  crowd_level: "realtime",
  cover_charge: "nightly",
  live_music_tonight: "nightly",
  last_entry_tonight: "nightly",
  dress_code: "static",
  price_tier: "static",
  wheelchair_accessible: "static",
  outdoor_area: "static",
  booking_required: "static",
};

export const DEFAULT_ATTRIBUTE_CLASS: AttributeClass = "nightly";

export function attributeClassFor(attributeKey: string): AttributeClass {
  return ATTRIBUTE_CLASSES[attributeKey] ?? DEFAULT_ATTRIBUTE_CLASS;
}

export interface AttributeConfidenceInput {
  attributeKey: string;
  lastVerifiedAt: Date;
  /**
   * Count of correction flags raised against this attribute in the last
   * 24h. Computed by the caller (a subquery in venue_attributes_resolved
   * on the SQL side) — this function does not filter by time itself.
   */
  flagCount: number;
  now?: Date;
}

// Pure function, no I/O. Must agree with attribute_confidence() in
// migrations/0001_attribute_confidence.sql for every input.
export function attributeConfidence({
  attributeKey,
  lastVerifiedAt,
  flagCount,
  now = new Date(),
}: AttributeConfidenceInput): Confidence {
  if (flagCount >= 2) return "unconfirmed";

  const { freshHours, ageingHours } = DECAY_RULES[attributeClassFor(attributeKey)];
  const ageHours = (now.getTime() - lastVerifiedAt.getTime()) / (1000 * 60 * 60);

  let confidence: Confidence;
  if (ageHours <= freshHours) confidence = "fresh";
  else if (ageHours <= ageingHours) confidence = "ageing";
  else confidence = "unconfirmed";

  if (flagCount >= 1 && confidence === "fresh") confidence = "ageing";

  return confidence;
}
