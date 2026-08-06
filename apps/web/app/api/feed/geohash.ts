// Minimal geohash + great-circle distance helpers for the feed cache
// (feed-cache.ts). geohashEncode buckets nearby requesters into the same
// cache cell; haversineDistanceMeters is what the cache uses to re-sort a
// cached cell's venues by each requester's own exact coordinates.

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function geohashEncode(lat: number, lng: number, precision: number): string {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let isEvenBit = true;
  let bitIndex = 0;
  let charCode = 0;
  let geohash = "";

  while (geohash.length < precision) {
    if (isEvenBit) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        charCode = (charCode << 1) | 1;
        lngMin = mid;
      } else {
        charCode = charCode << 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        charCode = (charCode << 1) | 1;
        latMin = mid;
      } else {
        charCode = charCode << 1;
        latMax = mid;
      }
    }
    isEvenBit = !isEvenBit;

    if (bitIndex < 4) {
      bitIndex++;
    } else {
      geohash += BASE32[charCode];
      bitIndex = 0;
      charCode = 0;
    }
  }

  return geohash;
}

// Inverse of geohashEncode: the centre of the bounding box a geohash string
// identifies. Used by location-gate.tsx to truncate a visitor's exact
// geolocation reading down to a geohash-6 cell (~600m) before it ever
// leaves the browser in a URL — CLAUDE.md invariant 6 permits persisting
// precinct + geohash-5 "at most"; geohash-6 is deliberately a notch finer
// (chosen so "closest venue first" is meaningful within a suburb) but still
// nowhere near exact-coordinate precision, and is never written to a
// database — only ever a query param.
export function geohashDecode(geohash: string): { lat: number; lng: number } {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let isEvenBit = true;

  for (const char of geohash) {
    const charCode = BASE32.indexOf(char);
    for (let bit = 4; bit >= 0; bit--) {
      const bitValue = (charCode >> bit) & 1;
      if (isEvenBit) {
        const mid = (lngMin + lngMax) / 2;
        if (bitValue === 1) lngMin = mid;
        else lngMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (bitValue === 1) latMin = mid;
        else latMax = mid;
      }
      isEvenBit = !isEvenBit;
    }
  }

  return { lat: (latMin + latMax) / 2, lng: (lngMin + lngMax) / 2 };
}

const EARTH_RADIUS_METERS = 6_371_000;

// Same formula as packages/db/src/geo.ts's haversineMeters, deliberately not
// imported from there: this file is pulled into the client bundle by
// location-gate.tsx (via geohashDecode), and @pulse/db's barrel export drags
// in the DB client module — exactly what the "stop lazy DB client crashing
// client bundles" fix removed from the client path.
export function haversineDistanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}
