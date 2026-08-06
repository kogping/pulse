import { z } from "zod";
import { ATTRIBUTE_REGISTRY_BY_KEY } from "./attribute-registry";

// Curator's editorial call on how strongly to push a venue — surfaced to
// ranking/placement on apps/web, not derived from any attribute.
export const QUALITY_TIERS = ["flagship", "solid", "hidden_gem"] as const;
export type QualityTier = (typeof QUALITY_TIERS)[number];

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeSchema = z.string().regex(TIME_PATTERN, "Use 24-hour HH:mm");

// closesAt may sort before opensAt (e.g. 22:00 -> 03:00) — a past-midnight
// close, not a validation error. Never add a closesAt > opensAt check here.
export const venueHoursRowSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    isClosed: z.boolean(),
    opensAt: timeSchema.nullable(),
    closesAt: timeSchema.nullable(),
    kitchenClosesAt: timeSchema.nullable().optional(),
  })
  .refine((row) => row.isClosed || (row.opensAt !== null && row.closesAt !== null), {
    message: "opensAt and closesAt are required unless the venue is closed that day",
    path: ["opensAt"],
  });
export type VenueHoursRowInput = z.infer<typeof venueHoursRowSchema>;

export const venueAttributeInputSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});
export type VenueAttributeFieldInput = z.infer<typeof venueAttributeInputSchema>;

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const venueInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    precinct: z.string().trim().min(1, "Precinct is required"),
    slug: z.string().trim().min(1, "Slug is required").regex(SLUG_PATTERN, "Slug must be lowercase and hyphen-separated"),
    address: z.string().trim().min(1).nullable().optional(),
    // Resolved coordinates only — the "map pin or address geocode" choice
    // happens client-side (venue-form.tsx); by the time this schema runs,
    // both paths have produced the same { lat, lng } shape.
    location: z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }),
    qualityTier: z.enum(QUALITY_TIERS),
    curatorPitch: z.string().trim().min(1, "Curator pitch is required"),
    // Curator-pasted direct image URL — takes priority over a Places photo
    // on read (provenance.ts's VenuePhoto). Optional: most venues, curated
    // or not, won't have one yet. An empty string (an untouched form field)
    // normalises to null rather than failing url() validation.
    photoUrl: z
      .string()
      .trim()
      .transform((value) => (value === "" ? null : value))
      .nullable()
      .optional()
      .refine((value) => value === null || value === undefined || z.string().url().safeParse(value).success, {
        message: "Must be a valid URL",
      }),
    hours: z.array(venueHoursRowSchema).min(1, "At least one opening-hours row is required"),
    attributes: z.array(venueAttributeInputSchema).default([]),
  })
  .superRefine((value, ctx) => {
    // A form may submit all seven day-of-week rows (most marked isClosed),
    // so array length alone doesn't guarantee the venue is ever open —
    // require at least one row that actually has hours.
    if (!value.hours.some((row) => !row.isClosed)) {
      ctx.addIssue({
        code: "custom",
        message: "At least one opening-hours row is required",
        path: ["hours"],
      });
    }
    value.attributes.forEach((attribute, index) => {
      const registryEntry = ATTRIBUTE_REGISTRY_BY_KEY.get(attribute.key);
      if (!registryEntry) {
        ctx.addIssue({
          code: "custom",
          message: `Unknown attribute key "${attribute.key}"`,
          path: ["attributes", index, "key"],
        });
        return;
      }
      const parsed = registryEntry.valueSchema.safeParse(attribute.value);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          message: parsed.error.issues[0]?.message ?? "Invalid value",
          path: ["attributes", index, "value"],
        });
      }
    });
  });
export type VenueInput = z.infer<typeof venueInputSchema>;

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

export function hoursSpanMidnight(row: { opensAt: string | null; closesAt: string | null }): boolean {
  if (!row.opensAt || !row.closesAt) return false;
  // HH:mm strings sort lexically the same as chronologically, so a plain
  // string compare is enough to detect a past-midnight close.
  return row.closesAt < row.opensAt;
}
