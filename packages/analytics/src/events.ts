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
  out_of_coverage_email_captured: undefined;
};

export type EventName = keyof EventPayloads;
