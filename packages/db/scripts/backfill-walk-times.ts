// Re-resolves venue_hub_links rows whose walk time came from the
// straight-line-distance fallback (Mapbox was down or timed out when the
// venue was created/moved) and links any venue that somehow has no hub
// links at all (e.g. seeded before this feature existed). Safe to re-run —
// linkVenueToNearestHubs replaces a venue's link set from scratch each time.
//
// Invoked manually or on a schedule; never from a Vercel build step
// (CLAUDE.md invariant #4 applies to this package's writes generally, not
// just migrations).
import { sql } from "drizzle-orm";
import { db } from "../src/client";
import { linkVenueToNearestHubs } from "../src/hub-links";

const dryRun = process.argv.includes("--dry-run");

interface PendingRow extends Record<string, unknown> {
  venueId: string;
}

async function main() {
  const estimatedRows = await db.execute<PendingRow>(sql`
    SELECT DISTINCT venue_id AS "venueId" FROM venue_hub_links WHERE is_estimated = true
  `);

  const unlinkedVenues = await db.execute<PendingRow>(sql`
    SELECT v.id AS "venueId"
    FROM venues v
    WHERE NOT EXISTS (SELECT 1 FROM venue_hub_links vhl WHERE vhl.venue_id = v.id)
  `);

  const pendingVenueIds = [
    ...new Set([...estimatedRows.rows, ...unlinkedVenues.rows].map((r) => r.venueId)),
  ];

  console.log(`Found ${estimatedRows.rows.length} estimated venue_hub_links row(s) pending backfill.`);
  console.log(`Found ${unlinkedVenues.rows.length} venue(s) with no transit hub links at all.`);
  console.log(`Total venues to (re)link: ${pendingVenueIds.length}.`);

  if (dryRun) {
    console.log("Dry run — no writes performed.");
    return;
  }

  let stillEstimated = 0;
  let resolved = 0;
  let failed = 0;

  for (const venueId of pendingVenueIds) {
    try {
      const [venueRow] = (
        await db.execute<{ lat: number; lng: number }>(sql`
          SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
          FROM venues WHERE id = ${venueId}
        `)
      ).rows;
      if (!venueRow) {
        console.warn(`  skip ${venueId}: venue no longer exists`);
        continue;
      }

      const links = await linkVenueToNearestHubs(venueId, { lat: venueRow.lat, lng: venueRow.lng });
      const estimatedCount = links.filter((l) => l.isEstimated).length;
      if (estimatedCount > 0) stillEstimated += estimatedCount;
      else resolved += links.length;
    } catch (error) {
      failed++;
      console.warn(`  failed to relink venue ${venueId}`, error);
    }
  }

  console.log(`Resolved (real Mapbox walk time): ${resolved}`);
  console.log(`Still estimated after retry: ${stillEstimated}`);
  console.log(`Venues that failed to relink entirely: ${failed}`);
}

await main();
