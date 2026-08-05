"use client";

import type { PrecinctOption } from "./api";

export interface PrecinctPickerProps {
  precincts: PrecinctOption[];
  loading: boolean;
  onSelect: (precinct: PrecinctOption) => void;
}

// Rendered in place of a spinner whenever the browser can't (or hasn't yet)
// told us where the visitor is — permission denied, geolocation
// unavailable, or geolocation just taking too long (F1.1's >3s branch).
export function PrecinctPicker({ precincts, loading, onSelect }: PrecinctPickerProps) {
  return (
    <div className="flex flex-col gap-3" data-testid="precinct-picker">
      <p className="text-sm text-ink-100">Which precinct are you heading out in?</p>
      {loading ? (
        <p className="text-sm text-ink-300">Loading precincts…</p>
      ) : precincts.length === 0 ? (
        <p className="text-sm text-ink-300">No precincts are live yet — check back soon.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {precincts.map((precinct) => (
            <button
              key={precinct.id}
              type="button"
              onClick={() => onSelect(precinct)}
              className="min-h-touch rounded-lg bg-ink-700 px-4 py-3 text-left text-base font-medium text-ink-50"
            >
              {precinct.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
