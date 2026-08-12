"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@pulse/ui";
import { fetchPrecincts, type PrecinctOption } from "./api";
import { PrecinctPicker } from "./precinct-picker";
import { rememberPrecinct } from "./storage";

export interface PrecinctSwitcherProps {
  currentPrecinctName: string;
  filtersParam?: string;
  // Carries the opt-in "this suburb only" restriction across a manual
  // switch — if it was on, it stays on, now scoped to the newly picked
  // precinct, rather than silently reverting to city-wide.
  precinctOnlyParam?: string;
}

// The always-available "changeable from header" side of F1.1 — reopening
// this never re-triggers the browser's geolocation permission prompt, it
// only ever offers the manual picker.
export function PrecinctSwitcher({ currentPrecinctName, filtersParam, precinctOnlyParam }: PrecinctSwitcherProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [precincts, setPrecincts] = useState<PrecinctOption[]>([]);
  const [loading, setLoading] = useState(false);

  function handleOpen() {
    setOpen(true);
    setLoading(true);
    fetchPrecincts().then((options) => {
      setPrecincts(options);
      setLoading(false);
    });
  }

  function handleSelect(precinct: PrecinctOption) {
    rememberPrecinct({ id: precinct.id, name: precinct.name });
    setOpen(false);
    const params = new URLSearchParams({ precinct: precinct.name, lat: String(precinct.lat), lng: String(precinct.lng) });
    if (filtersParam) params.set("filters", filtersParam);
    if (precinctOnlyParam) params.set("precinctOnly", precinctOnlyParam);
    router.replace(`/?${params.toString()}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="min-h-touch rounded-full bg-ink-700 px-3 text-sm font-medium text-ink-100"
        data-testid="precinct-switcher-open"
      >
        {currentPrecinctName}
      </button>
      <Sheet title="Change precinct" open={open} onClose={() => setOpen(false)}>
        <PrecinctPicker precincts={precincts} loading={loading} onSelect={handleSelect} />
      </Sheet>
    </>
  );
}
