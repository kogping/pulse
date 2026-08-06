// Static registry of precincts Pulse can operate in — the seed script
// (packages/db/scripts/seed.ts), the location-resolution API
// (apps/web/app/api/location/resolve), and the precinct picker
// (apps/web/app/api/precincts) all read from this one list so a precinct's
// id/name/hub coordinates can't drift between them. Whether a registered
// precinct is actually live is a separate question, answered at request
// time by @pulse/config's precinctFlag() against Edge Config — this list is
// "precincts Pulse knows how to serve", not "precincts currently enabled".
export interface PrecinctDef {
  id: string;
  name: string;
  // Transit hub coordinates, used as the precinct's centroid for
  // nearest-precinct matching and as the anchor point for a feed request
  // when a visitor picks this precinct manually rather than geolocating.
  lat: number;
  lng: number;
}

// Expanded for city-wide coverage (previously just Newtown + Kings Cross —
// the 2-precinct launch set). Every entry's coordinates are a real transit
// hub (train station, ferry wharf, or major bus interchange), used both as
// the nearest-area match centroid in /api/location/resolve and as the
// anchor point for a manually-picked area. This is not an exhaustive list
// of every Sydney suburb — the feed query itself is no longer scoped to
// these areas (see feed.ts's candidateAndOpenNowCte), so a visitor between
// two entries still gets a real, distance-ranked feed; this registry only
// needs a reasonably dense spread for "nearest enabled area" matching and
// the manual picker, not one entry per suburb.
export const PRECINCT_REGISTRY: PrecinctDef[] = [
  { id: "newtown", name: "Newtown", lat: -33.8975, lng: 151.1795 },
  { id: "kings-cross", name: "Kings Cross", lat: -33.8737, lng: 151.2232 },
  { id: "cbd", name: "Sydney CBD", lat: -33.8708, lng: 151.2073 },
  { id: "surry-hills", name: "Surry Hills", lat: -33.8843, lng: 151.2109 },
  { id: "darlinghurst", name: "Darlinghurst", lat: -33.8788, lng: 151.2198 },
  { id: "glebe", name: "Glebe", lat: -33.8799, lng: 151.1857 },
  { id: "redfern", name: "Redfern", lat: -33.8926, lng: 151.1990 },
  { id: "marrickville", name: "Marrickville", lat: -33.9111, lng: 151.1547 },
  { id: "balmain", name: "Balmain", lat: -33.8567, lng: 151.1807 },
  { id: "north-sydney", name: "North Sydney", lat: -33.8398, lng: 151.2073 },
  { id: "chatswood", name: "Chatswood", lat: -33.7969, lng: 151.1830 },
  { id: "manly", name: "Manly", lat: -33.7970, lng: 151.2877 },
  { id: "bondi-junction", name: "Bondi Junction", lat: -33.8915, lng: 151.2478 },
  { id: "bondi-beach", name: "Bondi Beach", lat: -33.8908, lng: 151.2743 },
  { id: "coogee", name: "Coogee", lat: -33.9198, lng: 151.2570 },
  { id: "randwick", name: "Randwick", lat: -33.9147, lng: 151.2413 },
  { id: "double-bay", name: "Double Bay", lat: -33.8776, lng: 151.2427 },
  { id: "parramatta", name: "Parramatta", lat: -33.8150, lng: 151.0011 },
  { id: "blacktown", name: "Blacktown", lat: -33.7714, lng: 150.9067 },
  { id: "penrith", name: "Penrith", lat: -33.7508, lng: 150.6939 },
  { id: "liverpool", name: "Liverpool", lat: -33.9200, lng: 150.9236 },
  { id: "bankstown", name: "Bankstown", lat: -33.9177, lng: 151.0349 },
  { id: "hurstville", name: "Hurstville", lat: -33.9670, lng: 151.1023 },
  { id: "cronulla", name: "Cronulla", lat: -34.0575, lng: 151.1522 },
  { id: "sutherland", name: "Sutherland", lat: -34.0313, lng: 151.0576 },
  { id: "rockdale", name: "Rockdale", lat: -33.9530, lng: 151.1385 },
];
