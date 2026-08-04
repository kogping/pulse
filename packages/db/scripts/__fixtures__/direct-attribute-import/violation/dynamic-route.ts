// Fixture: same violation, via a dynamic import (the pattern used
// elsewhere in the repo for driver-touching code, e.g. apps/console/lib/venue-store.ts).
export async function GET() {
  const { venueAttributes } = await import("@pulse/db");
  return venueAttributes;
}
