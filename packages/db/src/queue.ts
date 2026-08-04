import { eq, sql } from "drizzle-orm";
import { db } from "./client";
import { curators, venueAttributes, venues } from "./schema";
import { ATTRIBUTE_REGISTRY_BY_KEY, type AttributeInputType } from "./attribute-registry";
import { attributeConfidence, type Confidence } from "./freshness";

// The curator's-eye view of an attribute's current state. Deliberately NOT
// the public ResolvedVenueAttribute union (freshness.ts) — that type hides
// `value` when confidence is 'unconfirmed' because a *display* API must
// never show a user a value it can't vouch for. The queue is the opposite
// case: an unconfirmed attribute is exactly what the curator is here to
// look at, so the value must always be present alongside its confidence.
// Still a structured object with explicit provenance, never a bare string.
export interface QueueAttributeSnapshot {
  value: string;
  confidence: Confidence;
  lastVerifiedAt: Date;
}

export interface QueueItem {
  id: string; // venue_attributes.id — one row per queue item
  venueId: string;
  venueName: string;
  attributeKey: string;
  label: string;
  inputType: AttributeInputType;
  options?: readonly string[];
  current: QueueAttributeSnapshot;
  flagged: boolean;
}

export interface QueueCandidateRow {
  id: string;
  venueId: string;
  venueName: string;
  attributeKey: string;
  value: string;
  lastVerifiedAt: Date;
  flagCount: number;
}

// Pure shaping/ordering step, split out from nextQueueBatch so it's testable
// without a live database: flagged items first, then oldest
// last_verified_at first, LIMIT size. Rows for attribute keys outside the
// registry are dropped (the registry is the source of truth for what's
// curatable — see attribute-registry.ts).
export function buildQueueItems(rows: QueueCandidateRow[], size: number, now: Date): QueueItem[] {
  const items: QueueItem[] = [];
  for (const row of rows) {
    const entry = ATTRIBUTE_REGISTRY_BY_KEY.get(row.attributeKey);
    if (!entry) continue;
    items.push({
      id: row.id,
      venueId: row.venueId,
      venueName: row.venueName,
      attributeKey: row.attributeKey,
      label: entry.label,
      inputType: entry.inputType,
      options: entry.options,
      flagged: row.flagCount > 0,
      current: {
        value: row.value,
        lastVerifiedAt: row.lastVerifiedAt,
        confidence: attributeConfidence({
          attributeKey: row.attributeKey,
          lastVerifiedAt: row.lastVerifiedAt,
          flagCount: row.flagCount,
          now,
        }),
      },
    });
  }

  items.sort((a, b) => {
    if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
    return a.current.lastVerifiedAt.getTime() - b.current.lastVerifiedAt.getTime();
  });

  return items.slice(0, size);
}

// GET queue: attributes for the signed-in curator's precinct, flagged items
// first, then oldest last_verified_at first, LIMIT `size`. A curator with no
// precinct assigned gets an empty batch (apps/console renders an explainer,
// not a "you're all caught up" state, for that case).
export async function nextQueueBatch(curatorId: string, size = 20): Promise<QueueItem[]> {
  const [curator] = await db
    .select({ precinctId: curators.precinctId })
    .from(curators)
    .where(eq(curators.id, curatorId))
    .limit(1);
  if (!curator?.precinctId) return [];

  const rows = await db
    .select({
      id: venueAttributes.id,
      venueId: venues.id,
      venueName: venues.name,
      attributeKey: venueAttributes.attributeKey,
      value: venueAttributes.value,
      lastVerifiedAt: venueAttributes.lastVerifiedAt,
      // Correlated subquery mirrors the flag-count window used by
      // venue_attributes_resolved (migration 0001) — kept in sync by hand
      // since a view can't be reused inside an ORDER BY here.
      flagCount: sql<number>`(
        select count(*)::int from correction_flags cf
        where cf.venue_attribute_id = ${venueAttributes.id}
          and cf.flagged_at >= now() - interval '24 hours'
      )`,
    })
    .from(venueAttributes)
    .innerJoin(venues, eq(venues.id, venueAttributes.venueId))
    .where(eq(venues.precinct, curator.precinctId));

  return buildQueueItems(rows, size, new Date());
}
