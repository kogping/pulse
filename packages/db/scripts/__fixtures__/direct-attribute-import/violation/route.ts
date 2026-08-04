// Fixture for check-no-direct-attribute-import.test.ts: a deliberately
// non-compliant "route" that reads venue_attributes directly instead of
// going through getVenueForCard/getFeedVenues (packages/db/src/provenance.ts).
import { venueAttributes } from "@pulse/db";

export async function GET() {
  return venueAttributes;
}
