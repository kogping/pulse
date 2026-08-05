"use client";

import { useEffect } from "react";
import { track } from "@pulse/analytics";

export interface VenueAnalyticsProps {
  venueId: string;
  position: number;
  source: string;
}

// Fires once on mount (F2.1) — position/source describe where the visitor
// came from (e.g. their index in the feed and "feed"), passed through as
// query params from the link that opened this page.
export function VenueAnalytics({ venueId, position, source }: VenueAnalyticsProps) {
  useEffect(() => {
    track("venue_detail_opened", { venueId, position, source });
  }, [venueId, position, source]);

  return null;
}
