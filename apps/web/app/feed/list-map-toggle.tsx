"use client";

import { useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { VenueMapPin } from "./venue-map";

// mapbox-gl (and everything that imports it) must never appear in the
// initial JS chunk graph — see app/bundle-budget.test.ts. `ssr: false` plus
// this dynamic() call, only ever reached from inside the click handler
// below, is what pushes it into its own chunk instead of the page bundle.
const VenueMap = dynamic(() => import("./venue-map").then((mod) => mod.VenueMap), { ssr: false });

export interface ListMapToggleProps {
  pins: VenueMapPin[];
  /** The server-rendered venue list — passed through untouched so the map
   *  toggle never has to re-derive card markup or provenance data. */
  children: ReactNode;
}

// F1.5: toggles between the existing list (children) and a Mapbox pin view
// of the same ≤10 feed results. `hasLoadedMap` only ever flips false→true —
// once the map has been mounted, later toggles just show/hide it with CSS
// rather than unmounting, so the Mapbox GL map (and the billed "map load"
// it counts as) is created at most once per visit to this page, no matter
// how many times the visitor flips back and forth.
export function ListMapToggle({ pins, children }: ListMapToggleProps) {
  const [view, setView] = useState<"list" | "map">("list");
  const [hasLoadedMap, setHasLoadedMap] = useState(false);

  function toggle() {
    setView((current) => {
      const next = current === "list" ? "map" : "list";
      if (next === "map") setHasLoadedMap(true);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button
          type="button"
          data-testid="map-toggle"
          aria-pressed={view === "map"}
          onClick={toggle}
          className="inline-flex min-h-touch items-center rounded-full bg-ink-700 px-4 text-sm font-medium text-ink-100"
        >
          {view === "map" ? "List" : "Map"}
        </button>
      </div>

      <div className={view === "list" ? "" : "hidden"}>{children}</div>

      {hasLoadedMap ? (
        <div data-testid="venue-map-container" className={view === "map" ? "" : "hidden"}>
          <VenueMap pins={pins} />
        </div>
      ) : null}
    </div>
  );
}
