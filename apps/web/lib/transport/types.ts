// F3's response shapes for GET /api/transport/[hubId]. A discriminated
// union so a client can never render a countdown for a mode it didn't ask
// for — CLAUDE.md invariant #5 ("degrade honestly") applied to this
// endpoint's wire contract, not just its UI.

export interface LiveDeparture {
  route: string;
  headsign: string | null;
  /** Absolute ISO timestamp — comes straight from the GTFS-R predicted arrival/departure epoch, no timezone math involved. */
  departsAt: string;
}

export interface ScheduledDepartureView {
  route: string;
  headsign: string | null;
  /** Sydney-local 12h clock string, e.g. "1:15 AM" — a fixed label, never fed into a ticking countdown. */
  scheduledTime: string;
}

export type TransportPayload =
  | {
      mode: "live";
      nextDeparture: LiveDeparture;
      lastServiceTonight: ScheduledDepartureView | null;
      walkSeconds: number;
    }
  | {
      mode: "scheduled";
      nextDeparture: ScheduledDepartureView;
      lastServiceTonight: ScheduledDepartureView;
      walkSeconds: number;
    }
  | {
      mode: "missed_last_service";
      lastServiceTonight: ScheduledDepartureView;
      walkSeconds: number;
    }
  | {
      mode: "no_service_after_close";
      walkSeconds: number;
    };

// What GET /api/transport/[hubId] actually returns, and what the Redis
// cache stores — payload and fetchedAt are never separated, so there is no
// code path where a payload can be read without knowing its age (the
// client's >90s staleness check depends on this).
export interface TransportResponse {
  payload: TransportPayload;
  fetchedAt: string;
}
