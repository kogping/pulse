"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ATTRIBUTE_REGISTRY, generateSlug, venueInputSchema, type VenueInput } from "@pulse/db";
import type { VenueDetailRecord } from "@/lib/venue-store";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const QUALITY_TIER_LABELS: Record<string, string> = {
  flagship: "Flagship — must-visit",
  solid: "Solid — reliable pick",
  hidden_gem: "Hidden gem — under the radar",
};

interface HoursRowState {
  dayOfWeek: number;
  isClosed: boolean;
  opensAt: string;
  closesAt: string;
  kitchenClosesAt: string;
}

interface AttributeState {
  [key: string]: string;
}

interface FormState {
  name: string;
  precinct: string;
  slug: string;
  slugTouched: boolean;
  address: string;
  lat: string;
  lng: string;
  qualityTier: string;
  curatorPitch: string;
  hours: HoursRowState[];
  attributes: AttributeState;
}

function defaultHours(): HoursRowState[] {
  return DAY_LABELS.map((_, dayOfWeek) => ({
    dayOfWeek,
    isClosed: dayOfWeek === 1 || dayOfWeek === 2,
    opensAt: "18:00",
    closesAt: "00:00",
    kitchenClosesAt: "",
  }));
}

function toFormState(venue?: VenueDetailRecord): FormState {
  if (!venue) {
    return {
      name: "",
      precinct: "",
      slug: "",
      slugTouched: false,
      address: "",
      lat: "",
      lng: "",
      qualityTier: "",
      curatorPitch: "",
      hours: defaultHours(),
      attributes: {},
    };
  }
  const hoursByDay = new Map(venue.hours.map((h) => [h.dayOfWeek, h]));
  return {
    name: venue.name,
    precinct: venue.precinct,
    slug: venue.slug,
    slugTouched: true,
    address: venue.address ?? "",
    lat: String(venue.location.lat),
    lng: String(venue.location.lng),
    qualityTier: venue.qualityTier,
    curatorPitch: venue.curatorPitch,
    hours: DAY_LABELS.map((_, dayOfWeek) => {
      const row = hoursByDay.get(dayOfWeek);
      return {
        dayOfWeek,
        isClosed: row?.isClosed ?? true,
        opensAt: row?.opensAt ?? "18:00",
        closesAt: row?.closesAt ?? "00:00",
        kitchenClosesAt: row?.kitchenClosesAt ?? "",
      };
    }),
    attributes: Object.fromEntries(venue.attributes.map((a) => [a.key, a.value])),
  };
}

function toPayload(state: FormState): unknown {
  return {
    name: state.name,
    precinct: state.precinct,
    slug: state.slug,
    address: state.address.trim() ? state.address.trim() : null,
    location: { lat: Number(state.lat), lng: Number(state.lng) },
    qualityTier: state.qualityTier,
    curatorPitch: state.curatorPitch,
    hours: state.hours.map((row) => ({
      dayOfWeek: row.dayOfWeek,
      isClosed: row.isClosed,
      opensAt: row.isClosed ? null : row.opensAt,
      closesAt: row.isClosed ? null : row.closesAt,
      kitchenClosesAt: row.isClosed || !row.kitchenClosesAt ? null : row.kitchenClosesAt,
    })),
    attributes: Object.entries(state.attributes)
      .filter(([, value]) => value.trim() !== "")
      .map(([key, value]) => ({ key, value })),
  };
}

function collectFieldErrors(payload: unknown): Record<string, string[]> {
  const result = venueInputSchema.safeParse(payload);
  if (result.success) return {};
  const { fieldErrors } = result.error.flatten();
  const errors: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (messages) errors[field] = messages;
  }
  return errors;
}

export interface VenueFormProps {
  mode: "create" | "edit";
  venueId?: string;
  initialValue?: VenueDetailRecord;
}

export function VenueForm({ mode, venueId, initialValue }: VenueFormProps) {
  const router = useRouter();
  const [state, setState] = useState<FormState>(() => toFormState(initialValue));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const payload = useMemo(() => toPayload(state), [state]);

  function updateHoursRow(dayOfWeek: number, patch: Partial<HoursRowState>) {
    setState((prev) => ({
      ...prev,
      hours: prev.hours.map((row) => (row.dayOfWeek === dayOfWeek ? { ...row, ...patch } : row)),
    }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const fieldErrors = collectFieldErrors(payload);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(mode === "create" ? "/api/venues" : `/api/venues/${venueId}`, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload as VenueInput),
      });

      if (!response.ok) {
        const body = await response.json();
        setErrors(body.errors ?? { form: [body.error ?? "Save failed"] });
        return;
      }

      const body: { id: string } = await response.json();
      router.push(`/venues/${body.id}/edit`);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <fieldset>
        <legend>Venue</legend>

        <label htmlFor="name">Name</label>
        <input
          id="name"
          value={state.name}
          onChange={(e) => {
            const name = e.target.value;
            setState((prev) => ({ ...prev, name, slug: prev.slugTouched ? prev.slug : generateSlug(name) }));
          }}
          required
        />
        {errors.name && <p role="alert">{errors.name.join(", ")}</p>}

        <label htmlFor="precinct">Precinct</label>
        <input id="precinct" value={state.precinct} onChange={(e) => setState((p) => ({ ...p, precinct: e.target.value }))} required />
        {errors.precinct && <p role="alert">{errors.precinct.join(", ")}</p>}

        <label htmlFor="slug">Slug</label>
        <input
          id="slug"
          value={state.slug}
          onChange={(e) => setState((p) => ({ ...p, slug: e.target.value, slugTouched: true }))}
          required
        />
        {errors.slug && <p role="alert">{errors.slug.join(", ")}</p>}

        <label htmlFor="address">Address</label>
        <input id="address" value={state.address} onChange={(e) => setState((p) => ({ ...p, address: e.target.value }))} />

        {/* Location: drop a map pin (fills lat/lng below) or geocode the
            address above — both paths resolve to the same coordinate pair
            before submit. Full Mapbox pin UI is a follow-up; these fields
            are the resolved output either path produces. */}
        <label htmlFor="lat">Latitude</label>
        <input id="lat" type="number" step="any" value={state.lat} onChange={(e) => setState((p) => ({ ...p, lat: e.target.value }))} required />
        <label htmlFor="lng">Longitude</label>
        <input id="lng" type="number" step="any" value={state.lng} onChange={(e) => setState((p) => ({ ...p, lng: e.target.value }))} required />
        {errors.location && <p role="alert">{errors.location.join(", ")}</p>}

        <label htmlFor="qualityTier">Quality tier</label>
        <select id="qualityTier" value={state.qualityTier} onChange={(e) => setState((p) => ({ ...p, qualityTier: e.target.value }))} required>
          <option value="">Select a tier</option>
          {Object.entries(QUALITY_TIER_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {errors.qualityTier && <p role="alert">{errors.qualityTier.join(", ")}</p>}

        <label htmlFor="curatorPitch">Curator pitch</label>
        <textarea
          id="curatorPitch"
          value={state.curatorPitch}
          onChange={(e) => setState((p) => ({ ...p, curatorPitch: e.target.value }))}
          required
        />
        {errors.curatorPitch && <p role="alert">{errors.curatorPitch.join(", ")}</p>}
      </fieldset>

      <fieldset>
        <legend>Opening hours</legend>
        {errors.hours && <p role="alert">{errors.hours.join(", ")}</p>}
        {state.hours.map((row) => (
          <div key={row.dayOfWeek}>
            <span>{DAY_LABELS[row.dayOfWeek]}</span>
            <label>
              Closed
              <input
                type="checkbox"
                checked={row.isClosed}
                onChange={(e) => updateHoursRow(row.dayOfWeek, { isClosed: e.target.checked })}
              />
            </label>
            {!row.isClosed && (
              <>
                <label>
                  Opens
                  <input type="time" value={row.opensAt} onChange={(e) => updateHoursRow(row.dayOfWeek, { opensAt: e.target.value })} />
                </label>
                <label>
                  Closes
                  <input type="time" value={row.closesAt} onChange={(e) => updateHoursRow(row.dayOfWeek, { closesAt: e.target.value })} />
                </label>
                <label>
                  Kitchen closes
                  <input
                    type="time"
                    value={row.kitchenClosesAt}
                    onChange={(e) => updateHoursRow(row.dayOfWeek, { kitchenClosesAt: e.target.value })}
                  />
                </label>
              </>
            )}
          </div>
        ))}
      </fieldset>

      <fieldset>
        <legend>Attributes</legend>
        {ATTRIBUTE_REGISTRY.map((attribute) => (
          <div key={attribute.key}>
            <label htmlFor={`attr-${attribute.key}`}>{attribute.label}</label>
            {attribute.inputType === "select" || attribute.inputType === "boolean" ? (
              <select
                id={`attr-${attribute.key}`}
                value={state.attributes[attribute.key] ?? ""}
                onChange={(e) => setState((p) => ({ ...p, attributes: { ...p.attributes, [attribute.key]: e.target.value } }))}
              >
                <option value="">Not verified</option>
                {(attribute.options ?? ["yes", "no"]).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`attr-${attribute.key}`}
                type={attribute.inputType === "time" ? "time" : "text"}
                value={state.attributes[attribute.key] ?? ""}
                onChange={(e) => setState((p) => ({ ...p, attributes: { ...p.attributes, [attribute.key]: e.target.value } }))}
              />
            )}
            {errors[`attributes.${attribute.key}`] && <p role="alert">{errors[`attributes.${attribute.key}`]!.join(", ")}</p>}
          </div>
        ))}
      </fieldset>

      {errors.form && <p role="alert">{errors.form.join(", ")}</p>}
      <button type="submit" disabled={isSubmitting}>
        {mode === "create" ? "Create venue" : "Save changes"}
      </button>
    </form>
  );
}
