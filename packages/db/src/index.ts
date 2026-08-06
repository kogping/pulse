export const PACKAGE_NAME = "@pulse/db";

export { getDatabaseEnv, getEnv, getGooglePlacesEnv, getMapboxEnv, getUpstashEnv } from "./env";
export type { DatabaseEnv, Env, GooglePlacesEnv, MapboxEnv, UpstashEnv } from "./env";
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
export {
  applyOrDeferEdit,
  declareInterest,
  decidePendingEdit,
  hasDeclaredInterest,
  listPendingEdits,
} from "./coi";
export type { DecidePendingEditResult, EditRequest, PendingEditRecord } from "./coi";
export { resolvePublicAttribute } from "./public-attributes";
export {
  attributeViewSchema,
  assertValidAttributeViews,
  buildAttributeView,
  buildVenueCard,
  getVenueForCard,
  getVenuePhotoRef,
} from "./provenance";
export type { AttributeValue, AttributeView, AttributeViewRow, VenueCardData, VenuePhoto } from "./provenance";
export { formatClockTime, getVenueDetail } from "./venue-detail";
export type { TonightHours, VenueDetailData } from "./venue-detail";
export {
  FEED_CLOSING_BUFFER_MINUTES,
  FEED_SCORING_WEIGHTS,
  countVenuesPerFilter,
  getClosingSoonVenues,
  getFeedVenues,
  getFeedVenuesWithLocation,
  isOpenWithBuffer,
} from "./feed";
export type {
  CountVenuesPerFilterParams,
  FeedVenueWithLocation,
  GetFeedVenuesParams,
  VenueHoursInput,
} from "./feed";
export {
  INTENT_FILTER_REGISTRY,
  INTENT_FILTER_REGISTRY_BY_ID,
  NO_COVER_VALUE_TOKENS,
  isIntentFilterId,
  parseIntentFilterIds,
} from "./intent-filters";
export type { IntentFilterDef, IntentFilterId } from "./intent-filters";
export { bumpFeedCacheVersion, bumpPrecinctFeedCacheVersion, feedCacheVersionKey } from "./feed-cache";
export type { FeedCacheVersionClient } from "./feed-cache";
export {
  listPendingAuditSamples,
  pickWeightedSample,
  recordAuditVerdict,
  sampleAuditBatch,
  selectAuditSample,
  weeklyAuditAccuracy,
} from "./audit";
export type { AuditCandidateRow, PendingAuditItem, SampledAuditItem, WeeklyAccuracy } from "./audit";
export { PRECINCT_REGISTRY } from "./precincts";
export type { PrecinctDef } from "./precincts";
export { insertCorrectionFlag } from "./correction-flags";
export type { InsertCorrectionFlagInput, InsertCorrectionFlagResult } from "./correction-flags";
export {
  HUB_SEARCH_RADIUS_METERS,
  MAX_HUBS_PER_VENUE,
  computeVenueHubLinks,
  findNearestHubCandidates,
  getPrimaryHubForVenue,
  getTransitHubById,
  linkVenueToNearestHubs,
} from "./hub-links";
export type { HubCandidate, HubLinkResult, PrimaryHubForVenue, TransitHubSummary } from "./hub-links";
export { mapboxWalkingClient } from "./mapbox";
export type { LatLng, WalkingDirectionsClient } from "./mapbox";
export { getScheduledTransportForHub, resolveScheduledTransportState } from "./scheduled-transport";
export type { ScheduledDeparture, ScheduledDepartureRow, ScheduledTransportState } from "./scheduled-transport";
