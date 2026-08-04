// Bulk importer for the founding team's field-captured venue list.
//
// Every row is validated with the exact zod schema the console form uses
// (venueInputSchema from @pulse/db), so a row that would be rejected by the
// venue form is rejected here too. Nothing is written if any row fails
// validation — pass --force to import the valid rows and skip the rest.
// Missing lat/lng are geocoded via Mapbox from the address column.
//
// Idempotent on (precinct, slug): a venue that already exists there is
// updated in place (hours replaced, attributes upserted), never duplicated.
// Writes are attributed to a designated seed curator (--curator=email or
// SEED_CURATOR_EMAIL) via venues.created_by / venue_attributes.verified_by /
// verification_events, so seeded data carries the same provenance a curator
// typing it into the console would — never anonymous.
//
// See docs/import-format.md for the row schema and a filled example.
//
// Usage:
//   pnpm tsx scripts/import-venues.ts <file.csv|file.json> --dry-run
//   pnpm tsx scripts/import-venues.ts <file.csv|file.json> --curator=you@pulse.sydney
//   pnpm tsx scripts/import-venues.ts <file.csv|file.json> --curator=you@pulse.sydney --force
import { readFileSync } from "node:fs";
import path from "node:path";
import { venueInputSchema, type VenueInput } from "@pulse/db";

const DAY_COLUMNS = [
  "hours_sun",
  "hours_mon",
  "hours_tue",
  "hours_wed",
  "hours_thu",
  "hours_fri",
  "hours_sat",
] as const;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

type RawRow = Record<string, string>;

interface RowError {
  row: number;
  column: string;
  message: string;
}

interface CandidateVenue {
  name: string;
  precinct: string;
  slug: string;
  address: string | null;
  location: { lat: number; lng: number } | null;
  qualityTier: string;
  curatorPitch: string;
  hours: { dayOfWeek: number; isClosed: boolean; opensAt: string | null; closesAt: string | null }[];
  attributes: { key: string; value: string }[];
}

// --- CSV parsing (RFC4180-ish: quoted fields, embedded commas, "" escapes) ---

function splitCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  const normalized = content.replace(/\r\n/g, "\n");
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRow();
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function parseCsv(content: string): RawRow[] {
  const rows = splitCsvRows(content);
  if (rows.length === 0) return [];
  const header = rows[0]!;
  return rows.slice(1).map((cells) => {
    const row: RawRow = {};
    header.forEach((col, i) => {
      row[col.trim()] = cells[i] ?? "";
    });
    return row;
  });
}

function parseJson(content: string): RawRow[] {
  const data: unknown = JSON.parse(content);
  if (!Array.isArray(data)) throw new Error("JSON input must be an array of venue rows");
  return data.map((entry, i) => {
    if (typeof entry !== "object" || entry === null) throw new Error(`row ${i + 1}: expected an object`);
    const row: RawRow = {};
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      row[key] = value === null || value === undefined ? "" : String(value);
    }
    return row;
  });
}

// --- row -> candidate ---

function buildCandidate(raw: RawRow, rowNumber: number): { candidate: CandidateVenue; errors: RowError[] } {
  const errors: RowError[] = [];
  const get = (col: string) => (raw[col] ?? "").trim();

  const addressRaw = get("address");
  const address = addressRaw.length > 0 ? addressRaw : null;

  const latRaw = get("lat");
  const lngRaw = get("lng");
  let location: { lat: number; lng: number } | null = null;
  if (latRaw && lngRaw) {
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (Number.isNaN(lat)) errors.push({ row: rowNumber, column: "lat", message: `must be a number, got "${latRaw}"` });
    if (Number.isNaN(lng)) errors.push({ row: rowNumber, column: "lng", message: `must be a number, got "${lngRaw}"` });
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) location = { lat, lng };
  } else if (latRaw && !lngRaw) {
    errors.push({ row: rowNumber, column: "lng", message: "lat is set but lng is missing" });
  } else if (!latRaw && lngRaw) {
    errors.push({ row: rowNumber, column: "lat", message: "lng is set but lat is missing" });
  } else if (!address) {
    errors.push({
      row: rowNumber,
      column: "address",
      message: "address is required when lat/lng are both absent (needed for geocoding)",
    });
  }

  const hours: CandidateVenue["hours"] = [];
  DAY_COLUMNS.forEach((col, dayOfWeek) => {
    const cell = get(col);
    if (cell.length === 0) {
      errors.push({ row: rowNumber, column: col, message: 'required: "closed" or "HH:mm-HH:mm"' });
      return;
    }
    if (cell.toLowerCase() === "closed") {
      hours.push({ dayOfWeek, isClosed: true, opensAt: null, closesAt: null });
      return;
    }
    const parts = cell.split("-");
    const opensAt = parts[0];
    const closesAt = parts[1];
    if (parts.length !== 2 || !opensAt || !closesAt || !TIME_PATTERN.test(opensAt) || !TIME_PATTERN.test(closesAt)) {
      errors.push({ row: rowNumber, column: col, message: `must be "closed" or "HH:mm-HH:mm", got "${cell}"` });
      return;
    }
    hours.push({ dayOfWeek, isClosed: false, opensAt, closesAt });
  });

  const attributes: CandidateVenue["attributes"] = [];
  const attributesRaw = get("attributes");
  if (attributesRaw.length > 0) {
    for (const pair of attributesRaw.split(";").map((p) => p.trim()).filter((p) => p.length > 0)) {
      const eq = pair.indexOf("=");
      if (eq === -1) {
        errors.push({ row: rowNumber, column: "attributes", message: `malformed pair "${pair}", expected key=value` });
        continue;
      }
      const key = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!key) {
        errors.push({ row: rowNumber, column: "attributes", message: `malformed pair "${pair}", missing key` });
        continue;
      }
      attributes.push({ key, value });
    }
  }

  return {
    candidate: {
      name: get("name"),
      precinct: get("precinct"),
      slug: get("slug"),
      address,
      location,
      qualityTier: get("quality_tier"),
      curatorPitch: get("curator_pitch"),
      hours,
      attributes,
    },
    errors,
  };
}

function pathToColumn(issuePath: readonly (string | number)[]): string {
  const [head, second] = issuePath;
  switch (head) {
    case "location":
      return second === "lat" ? "lat" : "lng";
    case "hours":
      return typeof second === "number" ? (DAY_COLUMNS[second] ?? "hours") : "hours";
    case "attributes":
      return "attributes";
    case "qualityTier":
      return "quality_tier";
    case "curatorPitch":
      return "curator_pitch";
    default:
      return typeof head === "string" ? head : "row";
  }
}

async function geocodeAddress(address: string, token: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?${new URLSearchParams(
    { access_token: token, country: "au", limit: "1" },
  ).toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox geocoding failed (${res.status}) for "${address}"`);
  const data = (await res.json()) as { features?: { center?: [number, number] }[] };
  const center = data.features?.[0]?.center;
  if (!center) return null;
  const [lng, lat] = center;
  return { lat, lng };
}

function printErrorTable(errors: RowError[]): void {
  const sorted = [...errors].sort((a, b) => a.row - b.row || a.column.localeCompare(b.column));
  const rowWidth = Math.max(3, ...sorted.map((e) => String(e.row).length));
  const colWidth = Math.max(6, ...sorted.map((e) => e.column.length));
  console.log(`${errors.length} error(s):\n`);
  for (const e of sorted) {
    console.log(`  row ${String(e.row).padEnd(rowWidth)}  ${e.column.padEnd(colWidth)}  ${e.message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const filePath = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const curatorArg = args.find((a) => a.startsWith("--curator="));
  const curatorEmail = curatorArg ? curatorArg.slice("--curator=".length) : process.env.SEED_CURATOR_EMAIL;

  if (!filePath) {
    console.error("Usage: tsx scripts/import-venues.ts <file.csv|file.json> [--dry-run] [--force] [--curator=email]");
    process.exit(1);
    return;
  }

  const absolute = path.resolve(filePath);
  const content = readFileSync(absolute, "utf8");
  const ext = path.extname(absolute).toLowerCase();
  const rawRows = ext === ".json" ? parseJson(content) : parseCsv(content);

  if (rawRows.length === 0) {
    console.error("No rows found in input file.");
    process.exit(1);
    return;
  }

  const mapboxToken = process.env.MAPBOX_TOKEN;
  const errors: RowError[] = [];
  const validRows: { row: number; input: VenueInput }[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const rowNumber = i + 2; // +1 for 1-index, +1 for the header row
    const raw = rawRows[i]!;
    const { candidate, errors: structuralErrors } = buildCandidate(raw, rowNumber);
    errors.push(...structuralErrors);

    let location = candidate.location;
    const hasLocationInputError = structuralErrors.some((e) => e.column === "lat" || e.column === "lng" || e.column === "address");
    if (!location && !hasLocationInputError && candidate.address) {
      if (!mapboxToken) {
        errors.push({
          row: rowNumber,
          column: "lat",
          message: "lat/lng missing and MAPBOX_TOKEN is not set to geocode the address",
        });
      } else {
        try {
          const geocoded = await geocodeAddress(candidate.address, mapboxToken);
          if (!geocoded) {
            errors.push({ row: rowNumber, column: "address", message: `Mapbox found no match for "${candidate.address}"` });
          } else {
            location = geocoded;
          }
        } catch (err) {
          errors.push({ row: rowNumber, column: "address", message: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    const zodResult = venueInputSchema.safeParse({
      name: candidate.name,
      precinct: candidate.precinct,
      slug: candidate.slug,
      address: candidate.address,
      location: location ?? { lat: 0, lng: 0 },
      qualityTier: candidate.qualityTier,
      curatorPitch: candidate.curatorPitch,
      hours: candidate.hours,
      attributes: candidate.attributes,
    });

    if (!zodResult.success) {
      for (const issue of zodResult.error.issues) {
        const normalizedPath = issue.path.map((segment) => (typeof segment === "number" ? segment : String(segment)));
        errors.push({ row: rowNumber, column: pathToColumn(normalizedPath), message: issue.message });
      }
    }

    if (location && zodResult.success) {
      validRows.push({ row: rowNumber, input: zodResult.data });
    }
  }

  if (errors.length > 0) {
    printErrorTable(errors);
  } else {
    console.log("0 errors.");
  }
  console.log(`\n${validRows.length}/${rawRows.length} rows valid.`);

  if (dryRun) {
    process.exit(errors.length > 0 ? 1 : 0);
    return;
  }

  if (errors.length > 0 && !force) {
    console.error("\nAborting: fix the errors above, or re-run with --force to import the valid rows only. Nothing was written.");
    process.exit(1);
    return;
  }

  if (validRows.length === 0) {
    console.log("Nothing to import.");
    process.exit(0);
    return;
  }

  if (!curatorEmail) {
    console.error("Provide the seed curator via --curator=email@example.com or SEED_CURATOR_EMAIL (see docs/runbook/curators.md).");
    process.exit(1);
    return;
  }

  const { db, curators, venues, venueHours, venueAttributes, verificationEvents } = await import("@pulse/db");
  const { and, eq, sql } = await import("drizzle-orm");
  const { randomUUID } = await import("node:crypto");

  const [curator] = await db.select().from(curators).where(eq(curators.email, curatorEmail)).limit(1);
  if (!curator) {
    console.error(`No curator found for ${curatorEmail}. Add one first (see docs/runbook/curators.md).`);
    process.exit(1);
    return;
  }

  let created = 0;
  let updated = 0;

  for (const { input } of validRows) {
    const [existing] = await db
      .select({ id: venues.id })
      .from(venues)
      .where(and(eq(venues.precinct, input.precinct), eq(venues.slug, input.slug)))
      .limit(1);

    const venueId = existing?.id ?? randomUUID();
    const point = sql`ST_SetSRID(ST_MakePoint(${input.location.lng}, ${input.location.lat}), 4326)::geography`;

    type BatchQuery = Parameters<typeof db.batch>[0][number];
    const queries: BatchQuery[] = [];

    if (existing) {
      queries.push(
        db
          .update(venues)
          .set({
            name: input.name,
            address: input.address ?? null,
            qualityTier: input.qualityTier,
            curatorPitch: input.curatorPitch,
            location: point,
            updatedAt: new Date(),
          })
          .where(eq(venues.id, venueId)),
      );
      await db.delete(venueHours).where(eq(venueHours.venueId, venueId));
      updated++;
    } else {
      queries.push(
        db.insert(venues).values({
          id: venueId,
          precinct: input.precinct,
          name: input.name,
          slug: input.slug,
          address: input.address ?? null,
          qualityTier: input.qualityTier,
          curatorPitch: input.curatorPitch,
          createdBy: curator.id,
          location: point,
        }),
      );
      created++;
    }

    for (const hour of input.hours) {
      queries.push(
        db.insert(venueHours).values({
          venueId,
          dayOfWeek: hour.dayOfWeek,
          isClosed: hour.isClosed,
          opensAt: hour.opensAt,
          closesAt: hour.closesAt,
          kitchenClosesAt: hour.kitchenClosesAt ?? null,
        }),
      );
    }

    const existingAttributeIdByKey = new Map<string, string>();
    if (existing) {
      const rows = await db
        .select({ id: venueAttributes.id, key: venueAttributes.attributeKey })
        .from(venueAttributes)
        .where(eq(venueAttributes.venueId, venueId));
      for (const row of rows) existingAttributeIdByKey.set(row.key, row.id);
    }
    for (const attribute of input.attributes) {
      const existingAttributeId = existingAttributeIdByKey.get(attribute.key);
      const attributeId = existingAttributeId ?? randomUUID();
      if (existingAttributeId) {
        queries.push(
          db
            .update(venueAttributes)
            .set({ value: attribute.value, lastVerifiedAt: new Date(), verifiedBy: curator.id })
            .where(eq(venueAttributes.id, attributeId)),
        );
      } else {
        queries.push(
          db.insert(venueAttributes).values({
            id: attributeId,
            venueId,
            attributeKey: attribute.key,
            value: attribute.value,
            verifiedBy: curator.id,
          }),
        );
      }
      queries.push(
        db.insert(verificationEvents).values({
          venueAttributeId: attributeId,
          curatorId: curator.id,
          note: "imported from field capture",
        }),
      );
    }

    await db.batch(queries as [BatchQuery, ...BatchQuery[]]);
  }

  console.log(`\nImported: ${created} created, ${updated} updated.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
