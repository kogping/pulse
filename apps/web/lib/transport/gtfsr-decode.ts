import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import type { LiveDeparture } from "./types";

function toEpochSeconds(time: number | { toNumber(): number } | null | undefined): number | null {
  if (time === null || time === undefined) return null;
  if (typeof time === "number") return time;
  if (typeof time.toNumber === "function") return time.toNumber();
  return Number(time);
}

export interface DecodedLiveFeed {
  nextDeparture: LiveDeparture | null;
  /** The feed's own header.timestamp (when TfNSW's backend generated it) — a
   *  200 OK response can still wrap a feed that stopped updating upstream;
   *  callers compare this against `now` to catch that case (see
   *  get-transport-for-hub.ts's stale-feed check). Null if the header
   *  omitted it, which callers should treat the same as "too old to trust". */
  feedTimestampSeconds: number | null;
}

// Pure decode: takes a raw GTFS-R FeedMessage protobuf and the set of GTFS
// stop_ids belonging to one hub (a hub can span more than one platform/
// direction stop_id — see transit_hubs.gtfs_stop_id), and returns the
// single soonest upcoming departure among them, or null if the feed has
// nothing relevant (wrong feed, hub not served by this mode, or every
// matching trip has already departed). No I/O, no clock reads beyond the
// `now` passed in — unit-testable against recorded/synthetic fixtures with
// no network or Upstash involved (see countdown-accuracy.test.ts).
export function decodeLiveFeed(buffer: Uint8Array, gtfsStopIds: ReadonlySet<string>, now: Date): DecodedLiveFeed {
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);
  const feedTimestampSeconds = toEpochSeconds(feed.header?.timestamp);
  const nowSeconds = now.getTime() / 1000;

  let best: { epochSeconds: number; route: string; headsign: string | null } | null = null;

  for (const entity of feed.entity) {
    const tripUpdate = entity.tripUpdate;
    if (!tripUpdate) continue;
    const route = tripUpdate.trip?.routeId ?? null;
    if (!route) continue;

    for (const stopTimeUpdate of tripUpdate.stopTimeUpdate ?? []) {
      if (!stopTimeUpdate.stopId || !gtfsStopIds.has(stopTimeUpdate.stopId)) continue;

      const event = stopTimeUpdate.departure ?? stopTimeUpdate.arrival;
      const epochSeconds = toEpochSeconds(event?.time);
      // A predicted time in the past is a trip that's already left — GTFS-R
      // feeds don't always prune these promptly, so treat it as absent
      // rather than showing a departure that's already gone.
      if (epochSeconds === null || epochSeconds < nowSeconds) continue;

      if (!best || epochSeconds < best.epochSeconds) {
        best = { epochSeconds, route, headsign: stopTimeUpdate.stopTimeProperties?.stopHeadsign ?? null };
      }
    }
  }

  return {
    feedTimestampSeconds,
    nextDeparture: best
      ? { route: best.route, headsign: best.headsign, departsAt: new Date(best.epochSeconds * 1000).toISOString() }
      : null,
  };
}
