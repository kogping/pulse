"use client";

import { track } from "@pulse/analytics";

export interface DirectionsLinkProps {
  name: string;
  lat: number;
  lng: number;
}

function isIOS(userAgent: string): boolean {
  return /iPhone|iPad|iPod/.test(userAgent);
}

// Apple Maps on iOS, Google Maps everywhere else (F2.3). Both targets are
// https:// universal links rather than a custom scheme (maps://,
// comgooglemaps://) — each already opens the installed app when present and
// falls back to the map provider's own web app otherwise, so "with a web
// fallback" is satisfied by the URL itself rather than a second href.
export function directionsHref(name: string, lat: number, lng: number, userAgent: string): string {
  const label = encodeURIComponent(name);
  return isIOS(userAgent)
    ? `https://maps.apple.com/?daddr=${lat},${lng}&q=${label}`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

export function DirectionsLink({ name, lat, lng }: DirectionsLinkProps) {
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const href = directionsHref(name, lat, lng, userAgent);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="directions-link"
      onClick={() => track("directions_tapped")}
      className="min-h-touch inline-flex items-center justify-center rounded-full bg-accent-subtle px-4 text-sm font-medium text-ink-950"
    >
      Directions
    </a>
  );
}
