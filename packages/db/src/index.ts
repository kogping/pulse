export const PACKAGE_NAME = "@pulse/db";

export { getEnv } from "./env";
export type { Env } from "./env";
export { db, sql } from "./client";
export { redis } from "./redis";
export * from "./schema";
export {
  ATTRIBUTE_CLASSES,
  DECAY_RULES,
  DEFAULT_ATTRIBUTE_CLASS,
  attributeClassFor,
  attributeConfidence,
} from "./freshness";
export type { AttributeClass, AttributeConfidenceInput, Confidence, ResolvedVenueAttribute } from "./freshness";
export { ATTRIBUTE_REGISTRY, ATTRIBUTE_REGISTRY_BY_KEY } from "./attribute-registry";
export type { AttributeInputType, AttributeRegistryEntry } from "./attribute-registry";
export { nextQueueBatch } from "./queue";
export type { QueueAttributeSnapshot, QueueItem } from "./queue";
export {
  QUALITY_TIERS,
  generateSlug,
  hoursSpanMidnight,
  venueAttributeInputSchema,
  venueHoursRowSchema,
  venueInputSchema,
} from "./venue-input";
export type { QualityTier, VenueAttributeFieldInput, VenueHoursRowInput, VenueInput } from "./venue-input";
