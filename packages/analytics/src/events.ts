// Closed union of every trackable event, per roadmap §6. Adding an event
// requires adding a key here — track() has no free-form string overload, so
// an unlisted event name is a type error, not a silent no-op in production.
export type EventPayloads = {
  session_start: undefined;
  feed_rendered: {
    precinct: string;
    filterSet: string[];
    resultCount: number;
    positions: number[];
  };
  venue_detail_opened: {
    venueId: string;
    position: number;
    source: string;
  };
  directions_tapped: undefined;
  badge_flagged: {
    venueId: string;
    attributeKey: string;
  };
  transport_viewed: {
    mode: "live" | "scheduled" | "none";
  };
  filter_applied: undefined;
  empty_state_shown: {
    reason: string;
  };
  // Console-only: fired client-side per queue item on submit, for local
  // debugging via /debug/events. The durable, cross-curator record of the
  // same measurement lives in verification_events.duration_ms and is what
  // the console's /ops dashboard actually aggregates — this event is not
  // that dashboard's data source (see packages/analytics/src/store.ts: this
  // package has no server-side sink, browser localStorage only).
  verification_event: {
    action: "confirm" | "correct";
    attributeKey: string;
    durationMs: number;
  };
};

export type EventName = keyof EventPayloads;
