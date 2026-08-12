// Backfills venues across every PRECINCT_REGISTRY precinct with realistic
// hours and a spread of attribute ages (fresh / ageing / unconfirmed under
// the current decay rules), so preview branches and local dev have
// something worth curating city-wide, not just Newtown/Kings Cross.
// Additive only, never destructive: a Neon preview branch is forked off
// `production` (preview-db.yml), which may already carry real curator- and
// Google-Places-sourced venues (and real GTFS transit hubs/departures) —
// this script must never delete or overwrite any of that. Per precinct, it
// only inserts synthetic venues where no real coverage already exists
// nearby (see EXISTING_COVERAGE_RADIUS_METERS), reuses an existing curator/
// transit hub by email/name instead of re-inserting one, and is safe to
// re-run against the same database (a second run sees its own first run's
// rows as "already covered" and skips them). Safe to point at production
// too, though there should never be a reason to — everything it *does*
// write is obviously-synthetic fixture data.
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, sql } from "drizzle-orm";
import {
  correctionFlags,
  curators,
  scheduledDepartures,
  transitHubs,
  venueAttributes,
  venueHours,
  venueHubLinks,
  venues,
  verificationEvents,
} from "../src/schema";
import { QUALITY_TIERS } from "../src/venue-input";
import { PRECINCT_REGISTRY } from "../src/precincts";

// "Is there already a real venue right around this precinct's hub" check,
// radius-based rather than a venues.precinct text match — that column is
// free text set at import time (real suburb labels like "Haymarket",
// "Ultimo") and rarely equals a PRECINCT_REGISTRY name, so a text match
// would almost never detect real coverage (see feed.ts's
// PRECINCT_ONLY_RADIUS_METERS comment for the same reasoning). Comfortably
// covers the ~450m bbox synthetic venues themselves get scattered across.
const EXISTING_COVERAGE_RADIUS_METERS = 800;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed the database");
}

const db = drizzle(neon(databaseUrl));

interface Precinct {
  name: string;
  // Rough bounding box for scattering venue points, [minLon, maxLon, minLat, maxLat].
  bbox: [number, number, number, number];
  hub: { name: string; mode: string; lon: number; lat: number };
}

// One synthetic Precinct per PRECINCT_REGISTRY entry, centred on that
// precinct's real hub coordinates — same ~450m bbox width the original
// Newtown/Kings Cross-only version of this script used, just generated for
// all 26 rather than two hand-written entries. Order matches the registry,
// which keeps Newtown/Kings Cross first (PRECINCTS[0]/[1], still relied on
// by the curator-seeding step below) since that's the registry's own order.
const BBOX_HALF_WIDTH_DEGREES = 0.004;

const PRECINCTS: Precinct[] = PRECINCT_REGISTRY.map((precinct) => ({
  name: precinct.name,
  bbox: [
    precinct.lng - BBOX_HALF_WIDTH_DEGREES,
    precinct.lng + BBOX_HALF_WIDTH_DEGREES,
    precinct.lat - BBOX_HALF_WIDTH_DEGREES,
    precinct.lat + BBOX_HALF_WIDTH_DEGREES,
  ],
  hub: { name: `${precinct.name} Station`, mode: "train", lon: precinct.lng, lat: precinct.lat },
}));

const VENUE_NAME_PARTS = {
  prefixes: ["The", "Little", "Old", "Golden", "Night", "Southside", "Backstreet", "Corner", "Neon", "Velvet"],
  nouns: ["Lounge", "Bar", "Social", "Room", "Vault", "Terrace", "Den", "Hall", "Yard", "Parlour", "Club", "Bottle-O"],
};

const ATTRIBUTE_KEYS_BY_VENUE = [
  "queue_length",
  "cover_charge",
  "dress_code",
  "price_tier",
  "wheelchair_accessible",
  "live_music_tonight",
  "outdoor_area",
];

const ATTRIBUTE_VALUES: Record<string, string[]> = {
  queue_length: ["none", "short (<10 min)", "moderate (10-20 min)", "long (20+ min)"],
  cover_charge: ["free", "$10 after 10pm", "$15 after 9pm", "$20 weekends"],
  dress_code: ["casual", "smart casual", "no sportswear", "collared shirts only"],
  price_tier: ["$", "$$", "$$$"],
  wheelchair_accessible: ["yes", "no", "ground floor only"],
  live_music_tonight: ["yes", "no", "DJ set from 10pm"],
  outdoor_area: ["yes - rooftop", "yes - beer garden", "no"],
};

// Verification ages chosen to land in every confidence bucket across all
// three attribute classes (realtime/nightly/static) as defined in
// src/freshness.ts, so seeded data actually exercises fresh/ageing/unconfirmed.
const AGE_HOURS_SPREAD_BY_INDEX = [0.5, 4, 10, 30, 48, 200, 900];

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260804);

function pick<T>(items: T[]): T {
  const item = items[Math.floor(rand() * items.length)];
  if (item === undefined) throw new Error("pick() called on empty array");
  return item;
}

function slugify(name: string, index: number): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${index}`;
}

async function main() {
  console.log("Ensuring curators exist...");
  // precinctId assigned round-robin across PRECINCTS so the verification
  // queue (packages/db/src/queue.ts) has a scoped curator to seed against in
  // preview/local dev, not just via AUTH_TEST_CURATORS in e2e. Looked up by
  // email first (unique constraint) rather than inserted unconditionally —
  // a Neon preview branch forked from production may already have any of
  // these as real allow-listed curators (docs/runbook/curators.md), and
  // re-inserting would either throw (duplicate email) or, if it didn't,
  // orphan/hide real verification history attributed to the existing row.
  const curatorSeeds = [
    { email: "alex@pulse.sydney", name: "Alex Nguyen", precinctId: PRECINCTS[0]!.name },
    { email: "priya@pulse.sydney", name: "Priya Raman", precinctId: PRECINCTS[1]!.name },
    { email: "sam@pulse.sydney", name: "Sam O'Connell", precinctId: PRECINCTS[0]!.name },
    // Reviewer access for PR previews (docs/gates/curator-queue-week5.md
    // needs a real human clicking through /queue, not just Playwright).
    { email: "iijoshaus@gmail.com", name: "Josh", precinctId: PRECINCTS[0]!.name },
  ];
  const seededCurators: { id: string }[] = [];
  for (const seed of curatorSeeds) {
    const [existing] = await db.select({ id: curators.id }).from(curators).where(eq(curators.email, seed.email)).limit(1);
    if (existing) {
      seededCurators.push(existing);
      continue;
    }
    const [inserted] = await db.insert(curators).values(seed).returning({ id: curators.id });
    if (!inserted) throw new Error(`failed to insert curator ${seed.email}`);
    seededCurators.push(inserted);
  }

  console.log("Ensuring transit hubs exist...");
  // Looked up by name rather than inserted unconditionally — real hubs from
  // the weekly GTFS import (scripts/gtfs-import.ts) may already occupy this
  // precinct, and re-inserting would duplicate the hub and, since
  // scheduledDepartures below is only ever inserted (never cleared),
  // duplicate its timetable on every run too.
  const hubIdByPrecinct = new Map<string, string>();
  for (const precinct of PRECINCTS) {
    const [existingHub] = await db.select({ id: transitHubs.id }).from(transitHubs).where(eq(transitHubs.name, precinct.hub.name)).limit(1);
    if (existingHub) {
      hubIdByPrecinct.set(precinct.name, existingHub.id);
      continue;
    }

    const [hub] = await db
      .insert(transitHubs)
      .values({
        name: precinct.hub.name,
        mode: precinct.hub.mode,
        location: sql`ST_SetSRID(ST_MakePoint(${precinct.hub.lon}, ${precinct.hub.lat}), 4326)::geography`,
      })
      .returning({ id: transitHubs.id });
    if (!hub) throw new Error(`failed to insert hub for ${precinct.name}`);
    hubIdByPrecinct.set(precinct.name, hub.id);

    // A modest evening timetable, every day of the week — only for a hub
    // this run just created; an existing (real or previously-seeded) hub
    // already has its own.
    const departureRows = [];
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
      for (const minute of ["18:00", "18:15", "18:30", "19:00", "19:30", "20:00", "22:00", "23:30"]) {
        departureRows.push({
          transitHubId: hub.id,
          route: precinct.hub.mode === "train" ? "T4 Eastern Suburbs & Illawarra Line" : "Route 333",
          headsign: "City Circle",
          dayOfWeek,
          scheduledTime: minute,
        });
      }
    }
    await db.insert(scheduledDepartures).values(departureRows);
  }

  const venuesPerPrecinct = 10;
  console.log(`Backfilling up to ${venuesPerPrecinct} venues per precinct across ${PRECINCTS.length} precincts...`);
  let venueCounter = 0;
  let skippedPrecincts = 0;

  for (const precinct of PRECINCTS) {
    const coverageResult = await db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM venues
      WHERE ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint(${precinct.hub.lon}, ${precinct.hub.lat}), 4326)::geography,
        ${EXISTING_COVERAGE_RADIUS_METERS}
      )
    `);
    const existingCount = coverageResult.rows[0]?.count ?? 0;
    if (existingCount > 0) {
      console.log(`Skipping ${precinct.name} — ${existingCount} venue(s) already within ${EXISTING_COVERAGE_RADIUS_METERS}m`);
      skippedPrecincts++;
      continue;
    }

    const [minLon, maxLon, minLat, maxLat] = precinct.bbox;

    for (let i = 0; i < venuesPerPrecinct; i++) {
      venueCounter++;
      const name = `${pick(VENUE_NAME_PARTS.prefixes)} ${pick(VENUE_NAME_PARTS.nouns)}`;
      const slug = slugify(name, venueCounter);
      const lon = minLon + rand() * (maxLon - minLon);
      const lat = minLat + rand() * (maxLat - minLat);
      // Most (not all) seeded venues get a placeholder photo — Lorem
      // Picsum, seeded by slug so it's stable across re-seeds — so a
      // precinct with no real coverage yet (nothing from the weekly Places
      // import within EXISTING_COVERAGE_RADIUS_METERS) still has something
      // to render in VenueCard/the venue detail page, while still
      // exercising the no-photo path for a few venues.
      const photoUrl = rand() < 0.7 ? `https://picsum.photos/seed/${slug}/800/600` : null;

      const [venue] = await db
        .insert(venues)
        .values({
          precinct: precinct.name,
          name,
          slug,
          address: `${1 + Math.floor(rand() * 200)} ${precinct.name} Rd, ${precinct.name} NSW`,
          location: sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography`,
          qualityTier: pick([...QUALITY_TIERS]),
          curatorPitch: `A ${precinct.name} regular for a reason.`,
          photoUrl,
        })
        .returning({ id: venues.id });
      if (!venue) throw new Error("failed to insert venue");

      // Hours: closed Mon/Tue, open Wed-Sun with typical nightlife hours.
      const hourRows = [];
      for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
        const isClosed = dayOfWeek === 1 || dayOfWeek === 2; // Mon, Tue
        const isWeekend = dayOfWeek === 5 || dayOfWeek === 6; // Fri, Sat
        hourRows.push({
          venueId: venue.id,
          dayOfWeek,
          isClosed,
          opensAt: isClosed ? null : isWeekend ? "17:00" : "18:00",
          closesAt: isClosed ? null : isWeekend ? "03:00" : "00:00",
        });
      }
      await db.insert(venueHours).values(hourRows);

      // Attributes with a deliberate spread of verification ages so seeded
      // data lands in every confidence bucket.
      const attributeRows = ATTRIBUTE_KEYS_BY_VENUE.map((key, idx) => {
        const ageHours = AGE_HOURS_SPREAD_BY_INDEX[(venueCounter + idx) % AGE_HOURS_SPREAD_BY_INDEX.length];
        const lastVerifiedAt = new Date(Date.now() - ageHours! * 60 * 60 * 1000);
        return {
          venueId: venue.id,
          attributeKey: key,
          value: pick(ATTRIBUTE_VALUES[key]!),
          lastVerifiedAt,
          verifiedBy: pick(seededCurators).id,
        };
      });
      const insertedAttributes = await db.insert(venueAttributes).values(attributeRows).returning({
        id: venueAttributes.id,
      });

      // One confirm event per attribute, backdated to line up with
      // last_verified_at, and attributed to whoever verified it — so
      // /ops has real (if synthetic) history to aggregate against.
      await db.insert(verificationEvents).values(
        insertedAttributes.map((attribute, idx) => ({
          venueAttributeId: attribute.id,
          curatorId: attributeRows[idx]!.verifiedBy,
          verifiedAt: attributeRows[idx]!.lastVerifiedAt,
          action: "confirm",
        })),
      );

      // Flag a handful of attributes to exercise the flag-downgrade path
      // (flag_count >= 1 downgrades fresh -> ageing; >= 2 -> unconfirmed).
      if (venueCounter % 4 === 0) {
        const target = pick(insertedAttributes);
        await db.insert(correctionFlags).values({
          venueAttributeId: target.id,
          reporterSessionHash: `seed-session-${venueCounter}`,
          reason: "Looked out of date when I visited.",
        });
      }
      if (venueCounter % 7 === 0) {
        const target = pick(insertedAttributes);
        await db.insert(correctionFlags).values([
          {
            venueAttributeId: target.id,
            reporterSessionHash: `seed-session-${venueCounter}-a`,
            reason: "Wrong cover charge.",
          },
          {
            venueAttributeId: target.id,
            reporterSessionHash: `seed-session-${venueCounter}-b`,
            reason: "Confirmed wrong, still showing old value.",
          },
        ]);
      }

      // Link to the precinct's transit hub with a plausible walk time. Only
      // one hub is seeded per precinct, so it's trivially the primary.
      const hubId = hubIdByPrecinct.get(precinct.name);
      if (!hubId) throw new Error(`no hub for precinct ${precinct.name}`);
      await db.insert(venueHubLinks).values({
        venueId: venue.id,
        transitHubId: hubId,
        walkSeconds: (2 + Math.floor(rand() * 12)) * 60,
        isPrimary: true,
        isEstimated: false,
      });
    }
  }

  console.log(
    `Seeded ${venueCounter} venues across ${PRECINCTS.length - skippedPrecincts} precincts ` +
      `(${skippedPrecincts} already had real coverage and were left untouched).`,
  );
}

await main();
