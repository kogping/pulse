// Seeds 30 venues across 2 precincts with realistic hours and a spread of
// attribute ages (fresh / ageing / unconfirmed under the current decay
// rules), so preview branches and local dev have something worth curating.
// Idempotent-ish: truncates and re-inserts every run, so it's safe to
// re-run against a scratch/preview database. Never point this at production.
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
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

const PRECINCTS: Precinct[] = [
  {
    name: "Newtown",
    bbox: [151.176, 151.184, -33.901, -33.893],
    hub: { name: "Newtown Station", mode: "train", lon: 151.1795, lat: -33.8975 },
  },
  {
    name: "Kings Cross",
    bbox: [151.219, 151.227, -33.877, -33.869],
    hub: { name: "Kings Cross Station", mode: "train", lon: 151.2232, lat: -33.8737 },
  },
];

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
  console.log("Clearing existing seed data...");
  await db.delete(correctionFlags);
  await db.delete(scheduledDepartures);
  await db.delete(venueHubLinks);
  await db.delete(venueHours);
  await db.delete(venueAttributes);
  await db.delete(venues);
  await db.delete(transitHubs);
  await db.delete(curators);

  console.log("Seeding curators...");
  // precinctId assigned round-robin across PRECINCTS so the verification
  // queue (packages/db/src/queue.ts) has a scoped curator to seed against in
  // preview/local dev, not just via AUTH_TEST_CURATORS in e2e.
  const seededCurators = await db
    .insert(curators)
    .values([
      { email: "alex@pulse.sydney", name: "Alex Nguyen", precinctId: PRECINCTS[0]!.name },
      { email: "priya@pulse.sydney", name: "Priya Raman", precinctId: PRECINCTS[1]!.name },
      { email: "sam@pulse.sydney", name: "Sam O'Connell", precinctId: PRECINCTS[0]!.name },
      // Reviewer access for PR previews (docs/gates/curator-queue-week5.md
      // needs a real human clicking through /queue, not just Playwright).
      { email: "iijoshaus@gmail.com", name: "Josh", precinctId: PRECINCTS[0]!.name },
    ])
    .returning({ id: curators.id });

  console.log("Seeding transit hubs...");
  const hubIdByPrecinct = new Map<string, string>();
  for (const precinct of PRECINCTS) {
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

    // A modest evening timetable, every day of the week.
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

  console.log("Seeding 30 venues...");
  const venuesPerPrecinct = 15;
  let venueCounter = 0;

  for (const precinct of PRECINCTS) {
    const [minLon, maxLon, minLat, maxLat] = precinct.bbox;

    for (let i = 0; i < venuesPerPrecinct; i++) {
      venueCounter++;
      const name = `${pick(VENUE_NAME_PARTS.prefixes)} ${pick(VENUE_NAME_PARTS.nouns)}`;
      const lon = minLon + rand() * (maxLon - minLon);
      const lat = minLat + rand() * (maxLat - minLat);

      const [venue] = await db
        .insert(venues)
        .values({
          precinct: precinct.name,
          name,
          slug: slugify(name, venueCounter),
          address: `${1 + Math.floor(rand() * 200)} ${precinct.name} Rd, ${precinct.name} NSW`,
          location: sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography`,
          qualityTier: pick([...QUALITY_TIERS]),
          curatorPitch: `A ${precinct.name} regular for a reason.`,
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

      // Link to the precinct's transit hub with a plausible walk time.
      const hubId = hubIdByPrecinct.get(precinct.name);
      if (!hubId) throw new Error(`no hub for precinct ${precinct.name}`);
      await db.insert(venueHubLinks).values({
        venueId: venue.id,
        transitHubId: hubId,
        walkMinutes: 2 + Math.floor(rand() * 12),
      });
    }
  }

  console.log(`Seeded ${venueCounter} venues across ${PRECINCTS.length} precincts.`);
}

await main();
