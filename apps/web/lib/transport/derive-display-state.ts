import type { LiveDeparture, ScheduledDepartureView, TransportResponse } from "./types";

// Must match get-transport-for-hub.ts's STALE_THRESHOLD_MS — both layers
// agree on what "too old to trust" means, but this one is what actually
// protects the visitor: it runs against the client's own clock every tick,
// so a stale response held in React state across a backgrounded tab (or any
// caching bug upstream that served an old payload without saying so) still
// can't keep a countdown ticking. See CLAUDE.md invariant #5.
export const CLIENT_STALE_THRESHOLD_MS = 90_000;

export type TransportDisplayState =
  | {
      kind: "live";
      nextDeparture: LiveDeparture;
      lastServiceTonight: ScheduledDepartureView | null;
      walkSeconds: number;
      secondsUntilDeparture: number;
    }
  | {
      kind: "scheduled";
      nextDeparture: ScheduledDepartureView | null;
      lastServiceTonight: ScheduledDepartureView | null;
      walkSeconds: number;
    }
  | { kind: "missed_last_service"; lastServiceTonight: ScheduledDepartureView; walkSeconds: number }
  | { kind: "no_service_after_close"; walkSeconds: number };

// Pure, re-run on every countdown tick (not just on fetch) — see
// transport-countdown.tsx. Takes the last fetched response and the current
// instant; never reads Date.now() or any cache itself, so it's fully
// unit-testable — see transport-degradation.test.ts's >90s case.
export function deriveDisplayState(response: TransportResponse, now: Date): TransportDisplayState {
  const { payload } = response;
  const ageMs = now.getTime() - new Date(response.fetchedAt).getTime();

  if (payload.mode === "live" && ageMs > CLIENT_STALE_THRESHOLD_MS) {
    return {
      kind: "scheduled",
      nextDeparture: null,
      lastServiceTonight: payload.lastServiceTonight,
      walkSeconds: payload.walkSeconds,
    };
  }

  switch (payload.mode) {
    case "live":
      return {
        kind: "live",
        nextDeparture: payload.nextDeparture,
        lastServiceTonight: payload.lastServiceTonight,
        walkSeconds: payload.walkSeconds,
        secondsUntilDeparture: Math.max(
          0,
          Math.round((new Date(payload.nextDeparture.departsAt).getTime() - now.getTime()) / 1000),
        ),
      };
    case "scheduled":
      return {
        kind: "scheduled",
        nextDeparture: payload.nextDeparture,
        lastServiceTonight: payload.lastServiceTonight,
        walkSeconds: payload.walkSeconds,
      };
    case "missed_last_service":
      return { kind: "missed_last_service", lastServiceTonight: payload.lastServiceTonight, walkSeconds: payload.walkSeconds };
    case "no_service_after_close":
      return { kind: "no_service_after_close", walkSeconds: payload.walkSeconds };
  }
}
