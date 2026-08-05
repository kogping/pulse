import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getFlag } from "@pulse/config";
import { getScheduledTransportForHub, getTransitHubById, redis } from "@pulse/db";
import { getTransportForHub } from "../../../../lib/transport/get-transport-for-hub";

// Region is set app-wide by apps/web/vercel.json's regions:["syd1"]
// (CLAUDE.md invariant #1) — every function in this app runs there.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TFNSW_BASE_URL = "https://api.transport.nsw.gov.au";
const FETCH_TIMEOUT_MS = 4000;

// GTFS-R feed path per transit_hubs.mode (docs/spikes/tfnsw.md). Sydney has
// two light rail lines on separate feeds; innerwest is the default until a
// hub needs to disambiguate (known limitation, matches scripts/gtfs-import.ts's
// static-import limitations doc).
const MODE_TO_REALTIME_FEED: Record<string, string> = {
  train: "v2/sydneytrains",
  metro: "v2/metro",
  bus: "buses",
  ferry: "ferries/sydneyferries",
  light_rail: "v2/lightrail/innerwest",
};

async function fetchLiveFeedBuffer(feedPath: string): Promise<Uint8Array> {
  const apiKey = process.env.TFNSW_API_KEY;
  if (!apiKey) throw new Error("TFNSW_API_KEY is not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${TFNSW_BASE_URL}/v1/gtfs/realtime/${feedPath}`, {
      headers: { Authorization: `apikey ${apiKey}` },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`GTFS-R request failed: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

// F3's live/scheduled read path. `walkSeconds` comes in as a query param
// rather than a DB lookup here — the venue page already has it (from
// venue_hub_links, server-rendered) since this route is keyed by hub, not
// venue, so re-deriving "which venue" from a hub id would be both
// unnecessary and ambiguous (a hub can be a venue's primary for more than
// one venue).
export async function GET(request: NextRequest, { params }: { params: Promise<{ hubId: string }> }) {
  const { hubId } = await params;
  const walkSecondsParam = request.nextUrl.searchParams.get("walkSeconds");
  const walkSeconds = walkSecondsParam ? Number(walkSecondsParam) : NaN;

  if (!hubId || !Number.isFinite(walkSeconds) || walkSeconds < 0) {
    return NextResponse.json({ error: "hubId and a non-negative walkSeconds query param are required" }, { status: 400 });
  }

  const hub = await getTransitHubById(hubId);
  if (!hub) {
    return NextResponse.json({ error: "unknown hub" }, { status: 404 });
  }

  // Off => scheduled path only, no fetch at all: fetchLiveFeed below throws
  // before ever calling fetch(), so getTransportForHub falls straight to
  // the scheduled fallback without a single network call to TfNSW.
  const liveEnabled = await getFlag("transport_live_enabled");
  const feedPath = MODE_TO_REALTIME_FEED[hub.mode] ?? null;

  const response = await getTransportForHub(hubId, {
    redis,
    gtfsStopIds: new Set(hub.gtfsStopId ? [hub.gtfsStopId] : []),
    walkSeconds,
    getScheduledTransport: (now) => getScheduledTransportForHub(hubId, now),
    fetchLiveFeed: async () => {
      if (!liveEnabled || !feedPath || !hub.gtfsStopId) {
        throw new Error("live transport disabled or unsupported for this hub");
      }
      return fetchLiveFeedBuffer(feedPath);
    },
    logger: {
      warn: (message, meta) => Sentry.captureMessage(`[transport] ${message}`, { level: "warning", extra: meta }),
    },
  });

  return NextResponse.json(response);
}
