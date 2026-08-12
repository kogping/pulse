import { haversineDistanceMeters } from "../api/feed/geohash";

// Meters/km display for "distance from you" on a venue card. Purely a
// formatting step over coordinates that are already in-request only (the
// visitor's geohash-6 cell centre and each venue's own location) — nothing
// here is persisted, per CLAUDE.md invariant 6.
export function formatDistance(from: { lat: number; lng: number }, to: { lat: number; lng: number }): string {
  const meters = haversineDistanceMeters(from, to);
  if (meters < 1000) return `${Math.round(meters / 50) * 50}m away`;
  return `${(meters / 1000).toFixed(1)}km away`;
}
