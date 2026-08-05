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

export const PRECINCT_REGISTRY: PrecinctDef[] = [
  { id: "newtown", name: "Newtown", lat: -33.8975, lng: 151.1795 },
  { id: "kings-cross", name: "Kings Cross", lat: -33.8737, lng: 151.2232 },
];
