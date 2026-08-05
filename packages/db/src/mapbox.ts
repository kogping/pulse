import { getEnv } from "./env";
import { redis } from "./redis";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface WalkingDirectionsClient {
  /** Walking travel time in seconds between two points. Throws on any
   *  non-2xx response, timeout, or malformed body — callers are responsible
   *  for the straight-line fallback, never this client. */
  walkSeconds(from: LatLng, to: LatLng): Promise<number>;
}

// Re-onboarding a venue near one already linked should be free (per spec),
// and hub/venue coordinates barely move between backfill runs, so a long TTL
// is fine — this just bounds unbounded growth, not correctness.
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 90;
// Never let a slow Mapbox response hold up a venue save — a hung request is
// worse than a fast, correctly-flagged estimate.
const REQUEST_TIMEOUT_MS = 5000;

function round5dp(n: number): string {
  return n.toFixed(5);
}

function cacheKey(from: LatLng, to: LatLng): string {
  return `mapbox:walk:${round5dp(from.lat)},${round5dp(from.lng)}:${round5dp(to.lat)},${round5dp(to.lng)}`;
}

interface DirectionsResponse {
  routes?: { duration?: number }[];
}

function createMapboxWalkingClient(): WalkingDirectionsClient {
  return {
    async walkSeconds(from, to) {
      const key = cacheKey(from, to);
      const cached = await redis.get<number>(key);
      if (typeof cached === "number") return cached;

      const token = getEnv().MAPBOX_TOKEN;
      const url =
        `https://api.mapbox.com/directions/v5/mapbox/walking/` +
        `${from.lng},${from.lat};${to.lng},${to.lat}` +
        `?overview=false&access_token=${encodeURIComponent(token)}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!res.ok) throw new Error(`Mapbox Directions failed (${res.status})`);

      const data = (await res.json()) as DirectionsResponse;
      const duration = data.routes?.[0]?.duration;
      if (typeof duration !== "number") throw new Error("Mapbox Directions returned no route");

      const seconds = Math.round(duration);
      await redis.set(key, seconds, { ex: CACHE_TTL_SECONDS });
      return seconds;
    },
  };
}

export const mapboxWalkingClient: WalkingDirectionsClient = createMapboxWalkingClient();
