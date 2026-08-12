"use client";

import { useEffect, useState } from "react";
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
  // Start at the SSR default ("", which resolves to the Google Maps branch
  // below) and only read the real navigator.userAgent after mount. Server
  // and client render identically at hydration time this way — React
  // doesn't patch a mismatched attribute on hydration (it just logs a
  // warning and keeps whatever the server sent), so computing this
  // directly from navigator.userAgent during render permanently stuck
  // real iOS visitors with the Google Maps link. The effect's setState
  // forces a genuine post-hydration re-render instead, which does update
  // the DOM.
  const [userAgent, setUserAgent] = useState("");
  useEffect(() => {
    setUserAgent(navigator.userAgent);
  }, []);
  const href = directionsHref(name, lat, lng, userAgent);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="directions-link"
      onClick={() => track("directions_tapped")}
      className="min-h-touch inline-flex items-center justify-center bg-accent-subtle px-4 text-sm font-medium text-ink-950"
    >
      Directions
    </a>
  );
}
