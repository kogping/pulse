// CLI entry for the CI gate described in src/attribute-import-guard.ts:
// fails if anything under apps/web/app imports venueAttributes directly
// instead of going through getVenueForCard/getFeedVenues.
import path from "node:path";
import { findDirectAttributeImportViolations } from "../src/attribute-import-guard";

const webRoot = path.join(import.meta.dirname, "../../../apps/web/app");
const violations = findDirectAttributeImportViolations(webRoot);

if (violations.length > 0) {
  console.error("Direct venue_attributes import check failed:\n");
  for (const file of violations) {
    console.error(`  - apps/web/app/${file} imports venueAttributes directly. Use getVenueForCard/getFeedVenues from @pulse/db instead.`);
  }
  process.exit(1);
}

console.log("Direct venue_attributes import check passed.");
