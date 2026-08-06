import type { IntentFilterId, VenueCardData } from "@pulse/db";
import { INTENT_FILTER_REGISTRY_BY_ID } from "@pulse/db";

// F1.7: when a filter set returns fewer than RELAXATION_TARGET_RESULTS
// results, widen in disclosed steps rather than showing a bare empty state.
// Pure and dependency-injected — same shape as apps/web/app/api/feed/
// feed-cache.ts, which takes its Postgres call as deps.fetchVenues — so this
// is unit-testable without a database (see relaxation.test.ts).
export const RELAXATION_TARGET_RESULTS = 3;
// Widened for city-wide coverage: suburbs with sparse or no curator/Places
// density need rungs beyond the old 2km inner-Sydney ceiling before falling
// back to dropping a filter. DISTANCE_NORMALISER_METERS (feed.ts) is fixed
// independently, so these wider rungs only admit more venues — they don't
// flatten the ranking of ones already found nearby.
export const RADIUS_LADDER_METERS = [800, 1500, 3000, 6000] as const;

export type RelaxationRung =
  | { kind: "exact" }
  | { kind: "widen_radius"; radiusMeters: number }
  | { kind: "drop_filter"; dropped: IntentFilterId; radiusMeters: number }
  | { kind: "closing_soon" };

export interface RelaxationResult {
  /** Main feed section. Never contains a venue closing within 45 minutes,
   *  at any rung — that's what closingSoon is for. */
  venues: VenueCardData[];
  /** Separate, explicitly-labelled section, rendered below the fold. Only
   *  populated once the ladder reaches the closing_soon rung. */
  closingSoon: VenueCardData[];
  /** The rung the ladder settled on. */
  rung: RelaxationRung;
  /** UI copy naming the specific relaxation applied, or null at "exact"
   *  (nothing to disclose — the request already returned enough results). */
  disclosure: string | null;
  /** Every rung entered, in order — including the final one in `rung`. What
   *  proves "the ladder fires in order" rather than just "ends up right". */
  attempts: RelaxationRung[];
}

export interface RelaxationFetchArgs {
  radiusMeters: number;
  filters: IntentFilterId[];
}

export interface RelaxationDeps {
  fetchVenues: (args: RelaxationFetchArgs) => Promise<VenueCardData[]>;
  countVenuesPerFilter: (args: RelaxationFetchArgs) => Promise<Partial<Record<IntentFilterId, number>>>;
  fetchClosingSoon: (args: { radiusMeters: number }) => Promise<VenueCardData[]>;
}

export interface RelaxationParams {
  /** The visitor's requested filter set (open_now included conceptually, but
   *  it's a no-op here since the base query always enforces it). */
  filters: IntentFilterId[];
}

// The rung's UI-facing disclosure string, or null for "exact" (nothing
// relaxed, nothing to disclose). Kept as a pure function of the rung alone
// so the exact copy is trivially snapshot-testable per rung.
export function disclosureForRung(rung: RelaxationRung): string | null {
  switch (rung.kind) {
    case "exact":
      return null;
    case "widen_radius": {
      const km = rung.radiusMeters / 1000;
      const kmLabel = Number.isInteger(km) ? `${km}` : km.toFixed(1);
      return `Nothing exact — widening to ${kmLabel}km`;
    }
    case "drop_filter": {
      const label = INTENT_FILTER_REGISTRY_BY_ID.get(rung.dropped)?.label ?? rung.dropped;
      return `Still thin — showing results without the "${label}" filter`;
    }
    case "closing_soon":
      return "Nothing open long enough nearby — these venues close within 45 minutes";
  }
}

// empty_state_shown's `reason` payload for a rung entered because the
// previous rung came up short. "exact" never fires empty_state_shown (it's
// only fired once a rung was entered *because* the prior one had <3
// results), so it has no reason of its own.
export function analyticsReasonForRung(rung: RelaxationRung): string {
  switch (rung.kind) {
    case "exact":
      return "no_results_exact";
    case "widen_radius":
      return `no_results_radius_${rung.radiusMeters}`;
    case "drop_filter":
      return `no_results_dropped_filter:${rung.dropped}`;
    case "closing_soon":
      return "no_results_closing_soon";
  }
}

function pickLeastSelectiveFilter(
  droppable: readonly IntentFilterId[],
  counts: Partial<Record<IntentFilterId, number>>,
): IntentFilterId {
  return droppable.reduce((leastSelective, candidate) =>
    (counts[candidate] ?? 0) > (counts[leastSelective] ?? 0) ? candidate : leastSelective,
  );
}

// Applies the ladder in order, stopping as soon as a rung yields
// RELAXATION_TARGET_RESULTS or more. The 45-minute exclusion (F1.1-F1.4) is
// never relaxed: every rung above still calls deps.fetchVenues, which is
// backed by getFeedVenuesWithLocation's open_now CTE, and closing-soon
// venues only ever reach the caller through the dedicated closingSoon field.
export async function runRelaxationLadder(
  params: RelaxationParams,
  deps: RelaxationDeps,
): Promise<RelaxationResult> {
  const attempts: RelaxationRung[] = [];
  let activeFilters = params.filters;
  let radiusMeters: number = RADIUS_LADDER_METERS[0];

  const exactRung: RelaxationRung = { kind: "exact" };
  attempts.push(exactRung);
  let venues = await deps.fetchVenues({ radiusMeters, filters: activeFilters });
  if (venues.length >= RELAXATION_TARGET_RESULTS) {
    return { venues, closingSoon: [], rung: exactRung, disclosure: null, attempts };
  }

  for (const nextRadius of RADIUS_LADDER_METERS.slice(1)) {
    radiusMeters = nextRadius;
    const rung: RelaxationRung = { kind: "widen_radius", radiusMeters };
    attempts.push(rung);
    venues = await deps.fetchVenues({ radiusMeters, filters: activeFilters });
    if (venues.length >= RELAXATION_TARGET_RESULTS) {
      return { venues, closingSoon: [], rung, disclosure: disclosureForRung(rung), attempts };
    }
  }

  const droppable = activeFilters.filter((id) => INTENT_FILTER_REGISTRY_BY_ID.get(id)?.droppable);
  if (droppable.length > 0) {
    const counts = await deps.countVenuesPerFilter({ radiusMeters, filters: droppable });
    const dropped = pickLeastSelectiveFilter(droppable, counts);
    activeFilters = activeFilters.filter((id) => id !== dropped);

    const rung: RelaxationRung = { kind: "drop_filter", dropped, radiusMeters };
    attempts.push(rung);
    venues = await deps.fetchVenues({ radiusMeters, filters: activeFilters });
    if (venues.length >= RELAXATION_TARGET_RESULTS) {
      return { venues, closingSoon: [], rung, disclosure: disclosureForRung(rung), attempts };
    }
  }

  const closingSoonRung: RelaxationRung = { kind: "closing_soon" };
  attempts.push(closingSoonRung);
  const closingSoon = await deps.fetchClosingSoon({ radiusMeters });

  return {
    venues,
    closingSoon,
    rung: closingSoonRung,
    disclosure: disclosureForRung(closingSoonRung),
    attempts,
  };
}
