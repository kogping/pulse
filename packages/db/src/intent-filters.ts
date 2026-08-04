// F1.6: the five intent filters a visitor can compose (AND) against the
// feed. Mirrors attribute-registry.ts's pattern of being the single place
// that defines what a filter *is* — a filter can only key off an attribute
// already in ATTRIBUTE_REGISTRY (see venue-input.ts's "Unknown attribute
// key" guard), so this file is deliberately a thin projection over that
// registry rather than a parallel vocabulary.
export type IntentFilterId = "open_now" | "live_music" | "no_cover" | "outdoor" | "accessible";

export interface IntentFilterDef {
  id: IntentFilterId;
  label: string;
  /** Attribute this filter reads via venue_attributes_resolved. Null means
   *  the filter is already enforced unconditionally by the base feed query
   *  (open_now — see feed.ts's open_now CTE) and has no attribute predicate
   *  of its own. */
  attributeKey: string | null;
  /** Whether the relaxation ladder (F1.7) may drop this filter at rung 3.
   *  open_now never relaxes — the 45-minute rule is not negotiable. */
  droppable: boolean;
  /** Edge Config flag name gating this filter's visibility, if any. Kept as
   *  a string literal rather than importing @pulse/config's StaticFlagName
   *  to avoid a cross-package dependency for a single type. */
  flagName?: "accessibility_filter_enabled";
}

export const INTENT_FILTER_REGISTRY: readonly IntentFilterDef[] = [
  { id: "open_now", label: "Open now", attributeKey: null, droppable: false },
  { id: "live_music", label: "Live music", attributeKey: "live_music_tonight", droppable: true },
  { id: "no_cover", label: "No cover", attributeKey: "cover_charge", droppable: true },
  { id: "outdoor", label: "Outdoor area", attributeKey: "outdoor_area", droppable: true },
  {
    id: "accessible",
    label: "Wheelchair accessible",
    attributeKey: "wheelchair_accessible",
    droppable: true,
    flagName: "accessibility_filter_enabled",
  },
];

export const INTENT_FILTER_REGISTRY_BY_ID: ReadonlyMap<IntentFilterId, IntentFilterDef> = new Map(
  INTENT_FILTER_REGISTRY.map((entry) => [entry.id, entry]),
);

// Tokens accepted as "no cover" for the free-text cover_charge attribute.
// There is no structured boolean field for this — cover_charge is curator
// free text ("$15 after 9pm", "free") — so this is a known, documented
// limitation rather than a real enum match.
export const NO_COVER_VALUE_TOKENS = ["free", "none", "no", "$0", "0"] as const;

export function isIntentFilterId(value: string): value is IntentFilterId {
  return INTENT_FILTER_REGISTRY_BY_ID.has(value as IntentFilterId);
}

export function parseIntentFilterIds(raw: readonly string[]): IntentFilterId[] {
  return raw.filter(isIntentFilterId);
}
