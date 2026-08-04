import { z } from "zod";
import { attributeClassFor, type AttributeClass } from "./freshness";

// PRD §8.2 attribute set. This is the single place that defines what a
// venue attribute *is* — key, label, allowed values, which form control
// edits it, and (via attributeClassFor) how fast it decays. The console's
// venue form renders itself from this list, so adding an attribute is a
// registry entry here, not new form code (see apps/console/app/venues/venue-form.tsx).
export type AttributeInputType = "select" | "text" | "boolean" | "time";

export interface AttributeRegistryEntry {
  key: string;
  label: string;
  decayClass: AttributeClass;
  inputType: AttributeInputType;
  options?: readonly string[];
  // Validates the raw string stored in venue_attributes.value (the column
  // is untyped text — this is the only place a value's shape is enforced).
  valueSchema: z.ZodType<string>;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function buildEntry(
  key: string,
  label: string,
  inputType: AttributeInputType,
  options?: readonly string[],
): AttributeRegistryEntry {
  const valueSchema: z.ZodType<string> =
    inputType === "boolean"
      ? z.enum(["yes", "no"])
      : inputType === "time"
        ? z.string().regex(TIME_PATTERN, "Use 24-hour HH:mm")
        : options
          ? z.enum(options as [string, ...string[]])
          : z.string().trim().min(1, "Required");

  return { key, label, decayClass: attributeClassFor(key), inputType, options, valueSchema };
}

export const ATTRIBUTE_REGISTRY: readonly AttributeRegistryEntry[] = [
  buildEntry("queue_length", "Queue length", "select", [
    "none",
    "short (<10 min)",
    "moderate (10-20 min)",
    "long (20+ min)",
  ]),
  buildEntry("crowd_level", "Crowd level", "select", ["quiet", "moderate", "busy", "packed"]),
  buildEntry("cover_charge", "Cover charge", "text"),
  buildEntry("live_music_tonight", "Live music tonight", "boolean"),
  buildEntry("last_entry_tonight", "Last entry tonight", "time"),
  buildEntry("dress_code", "Dress code", "text"),
  buildEntry("price_tier", "Price tier", "select", ["$", "$$", "$$$"]),
  buildEntry("wheelchair_accessible", "Wheelchair accessible", "boolean"),
  buildEntry("outdoor_area", "Outdoor area", "text"),
  buildEntry("booking_required", "Booking required", "boolean"),
];

export const ATTRIBUTE_REGISTRY_BY_KEY: ReadonlyMap<string, AttributeRegistryEntry> = new Map(
  ATTRIBUTE_REGISTRY.map((entry) => [entry.key, entry]),
);
