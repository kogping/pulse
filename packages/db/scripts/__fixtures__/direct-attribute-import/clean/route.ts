// Fixture: the compliant version — reads through the provenance-typed API,
// never imports venue_attributes itself.
import { getFeedVenues, venues } from "@pulse/db";

export async function GET() {
  return getFeedVenues({ precinct: "cbd" });
}

export function unrelatedImport() {
  return venues;
}
