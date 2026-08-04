"use client";

import { useEffect } from "react";
import { track } from "@pulse/analytics";
import { analyticsReasonForRung, type RelaxationRung } from "./relaxation";

export interface FeedAnalyticsProps {
  precinct: string;
  filters: string[];
  resultCount: number;
  attempts: RelaxationRung[];
}

// track() writes to browser localStorage (packages/analytics/src/store.ts
// has no server-side sink), so firing has to happen client-side even though
// the feed page itself is a server component. Every rung entered beyond
// "exact" fires empty_state_shown with the specific reason the ladder
// dropped to that rung — see relaxation.ts's analyticsReasonForRung.
export function FeedAnalytics({ precinct, filters, resultCount, attempts }: FeedAnalyticsProps) {
  const filterKey = filters.join(",");
  const attemptsKey = attempts.map((rung) => JSON.stringify(rung)).join("|");

  useEffect(() => {
    track("feed_rendered", {
      precinct,
      filterSet: filters,
      resultCount,
      positions: Array.from({ length: resultCount }, (_, index) => index),
    });

    if (filters.length > 0) track("filter_applied");

    for (const rung of attempts) {
      if (rung.kind === "exact") continue;
      track("empty_state_shown", { reason: analyticsReasonForRung(rung) });
    }
    // Deliberately fingerprinted via filterKey/attemptsKey rather than the
    // raw arrays/objects (which change identity every render).
  }, [precinct, filterKey, resultCount, attemptsKey]);

  return null;
}
