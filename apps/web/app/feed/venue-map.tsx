"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

export interface VenueMapPin {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface VenueMapProps {
  pins: VenueMapPin[];
}

const SYDNEY_CBD: [number, number] = [151.2093, -33.8688];

// Public (pk.*) token, deliberately distinct from packages/db's server-only
// MAPBOX_TOKEN (used for the Directions API) — this one ships to the
// browser, inlined at build time by Next.js's NEXT_PUBLIC_ convention.
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// This component is only ever mounted once per feed page view (see
// list-map-toggle.tsx's hasLoadedMap gate) and never unmounts while the
// toggle is flipped back to "list" — it's hidden via CSS instead — so the
// mapboxgl.Map constructor below runs at most once per visit, which is what
// actually keeps this within Mapbox's per-load billing budget.
export function VenueMap({ pins }: VenueMapProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: pins[0] ? [pins[0].lng, pins[0].lat] : SYDNEY_CBD,
      zoom: 13,
    });
    mapRef.current = map;

    const bounds = new mapboxgl.LngLatBounds();
    for (const pin of pins) {
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute("data-testid", `map-pin-${pin.id}`);
      el.setAttribute("aria-label", pin.name);
      el.className = "h-4 w-4 rounded-full border-2 border-ink-950 bg-accent";
      // Full navigation (not client-side routing) so the venue page always
      // gets a real server render — same as every other venue link on the
      // feed (see page.tsx's <Link href={`/venue/${venue.id}...`}>).
      el.addEventListener("click", () => router.push(`/venue/${pin.id}?source=map`));
      new mapboxgl.Marker({ element: el }).setLngLat([pin.lng, pin.lat]).addTo(map);
      bounds.extend([pin.lng, pin.lat]);
    }
    if (pins.length > 1) map.fitBounds(bounds, { padding: 40, maxZoom: 15 });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Deliberately mount-once: this effect must not re-run when `pins` or
    // `router`'s references change (rebuilding the map on every such change
    // would defeat the load-once guard list-map-toggle.tsx relies on).
  }, []);

  if (!MAPBOX_TOKEN) {
    // Degrade honestly (CLAUDE.md invariant #5, in spirit): no public
    // token configured means no map, never a broken or blank one.
    return (
      <div
        role="status"
        data-testid="venue-map-unavailable"
        className="flex min-h-[320px] items-center justify-center rounded-lg bg-ink-700 text-sm text-ink-100"
      >
        Map unavailable
      </div>
    );
  }

  return <div ref={containerRef} data-testid="venue-map" className="h-[320px] w-full rounded-lg" />;
}
