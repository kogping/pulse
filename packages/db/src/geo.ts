// Shared great-circle distance helper for server-side callers (hub-links.ts,
// scripts/lib/gtfs/parse.ts). Not used by apps/web/app/api/feed/geohash.ts —
// that copy has to stay a separate, dependency-free file because it's
// imported by a client component (location-gate.tsx), and this package's
// barrel export pulls in the DB client's module-level side effects (see the
// "stop lazy DB client crashing client bundles" fix), which must never ship
// to the browser.
const EARTH_RADIUS_METERS = 6_371_000;

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}
