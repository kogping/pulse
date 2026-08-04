# Venue import format

`scripts/import-venues.ts` bulk-loads venues from the founding team's field
capture (or any future batch of venues) into `packages/db`. It validates
every row with the same `venueInputSchema` the console's venue form
(`apps/console/app/venues/venue-form.tsx`) submits to, so a row that the
form would reject is rejected here too.

```
pnpm tsx scripts/import-venues.ts <file.csv|file.json> [--dry-run] [--force] [--curator=email]
# or, from the repo root:
pnpm import:venues <file.csv|file.json> [--dry-run] [--force] [--curator=email]
```

- **`--dry-run`** — validate and geocode only. Prints the error table (or
  `0 errors.`) and exits; never touches the database.
- **`--force`** — with real (non-dry-run) writes, import the rows that
  passed validation and skip the rest, instead of aborting on the first
  invalid row.
- **`--curator=email`** — the seed curator whose id is attributed to every
  row imported (see [Attribution](#attribution) below). Falls back to the
  `SEED_CURATOR_EMAIL` env var. Required for real writes; irrelevant for
  `--dry-run`.

If **any** row fails validation and `--force` isn't passed, nothing is
written — the script prints a per-row, per-column error table and exits
non-zero.

## Row schema

Each row (a CSV line or a JSON array entry) has these fields:

| Column          | Required                 | Format                                                              |
| --------------- | ------------------------ | -------------------------------------------------------------------- |
| `name`          | yes                      | non-empty string                                                     |
| `precinct`      | yes                      | non-empty string (free text, matches `venues.precinct`)              |
| `slug`          | yes                      | lowercase, hyphen-separated (`^[a-z0-9]+(-[a-z0-9]+)*$`)              |
| `address`       | if `lat`/`lng` are blank | street address string, used for geocoding                            |
| `lat`, `lng`    | either both or neither   | decimal degrees; if both blank, geocoded from `address` via Mapbox   |
| `quality_tier`  | yes                      | one of `flagship`, `solid`, `hidden_gem`                              |
| `curator_pitch` | yes                      | non-empty string                                                      |
| `hours_sun`     | yes                      | `"closed"` or `"HH:mm-HH:mm"` (24h)                                   |
| `hours_mon`     | yes                      | same format                                                           |
| `hours_tue`     | yes                      | same format                                                           |
| `hours_wed`     | yes                      | same format                                                           |
| `hours_thu`     | yes                      | same format                                                           |
| `hours_fri`     | yes                      | same format                                                           |
| `hours_sat`     | yes                      | same format                                                           |
| `attributes`    | no                       | `key=value;key2=value2` — see [Attributes](#attributes)               |

A row must have at least one day that isn't `"closed"` — a venue with all
seven days closed is rejected (same rule the console form enforces).

An `hours_*` value that closes after midnight (e.g. `22:00-03:00`) is valid
— `closesAt` sorting before `opensAt` means a past-midnight close, not an
error (see `packages/db/src/venue-input.ts`). Kitchen closing time isn't
importable via this schema; add it later through the console if needed.

### Attributes

Format: semicolon-separated `key=value` pairs, e.g.

```
queue_length=short (<10 min);cover_charge=$15 after 9pm;live_music_tonight=yes
```

`key` must be one of the keys in `packages/db/src/attribute-registry.ts`
(`queue_length`, `crowd_level`, `cover_charge`, `live_music_tonight`,
`last_entry_tonight`, `dress_code`, `price_tier`, `wheelchair_accessible`,
`outdoor_area`, `booking_required`), and `value` must pass that key's
`valueSchema` (e.g. `price_tier` only accepts `$` / `$$` / `$$$`;
`live_music_tonight` only accepts `yes` / `no`). An unknown key or an
out-of-range value is a validation error on the `attributes` column.

### JSON input

The same flat field names as the CSV header, as an array of objects. Values
that would be a string in CSV should be given as strings; `lat`/`lng` may be
numbers:

```json
[
  {
    "name": "The Vanguard",
    "precinct": "Newtown",
    "slug": "the-vanguard",
    "address": "42 King St, Newtown NSW",
    "lat": -33.8974,
    "lng": 151.1795,
    "quality_tier": "flagship",
    "curator_pitch": "Live music mainstay with a kitchen that goes till late.",
    "hours_sun": "closed",
    "hours_mon": "closed",
    "hours_tue": "18:00-23:00",
    "hours_wed": "18:00-23:00",
    "hours_thu": "18:00-00:00",
    "hours_fri": "17:00-03:00",
    "hours_sat": "17:00-03:00",
    "attributes": "queue_length=short (<10 min);cover_charge=$15 after 9pm;live_music_tonight=yes;price_tier=$$;wheelchair_accessible=yes"
  }
]
```

## Filled example (CSV)

See `fixtures/venues-sample.csv` for a complete, valid four-row example
covering all four combinations worth showing: pure text attributes, a
past-midnight close, an address with no `lat`/`lng` (geocoded), and every
`quality_tier` value. `fixtures/venues-invalid.csv` has one deliberate error
per row (bad slug, missing precinct, bad `quality_tier`, malformed hours
cell, unknown attribute key, and a `lat` with no matching `lng`) — running
`--dry-run` against it prints the exact row/column/message for each.

## Geocoding

If `lat`/`lng` are both blank, the script geocodes `address` via the Mapbox
Geocoding API, biased to Australia (`country=au`). Set `MAPBOX_TOKEN` in the
environment before running against rows that omit coordinates — without it,
those rows fail validation with a clear "MAPBOX_TOKEN is not set" error
rather than silently skipping geocoding. Coordinates are resolved once at
import time and stored as the venue's address point; this is a curated
business location, not a user location, so it isn't covered by the
no-precise-location-persistence invariant (see `packages/db/src/schema/venues.ts`).

## Idempotency

Rows are keyed on `(precinct, slug)`. Re-running the same input:

- **Existing venue** (same `precinct` + `slug`): updates `name`, `address`,
  `location`, `quality_tier`, `curator_pitch`, replaces all `venue_hours`
  rows, and upserts each attribute in `venue_attributes` (by key) — no new
  venue row, no duplicate attribute rows.
- **New venue**: inserted as normal.

The venue count is unchanged on a second run with the same input. Every
attribute write — first import or a later re-run — still appends a
`verification_events` row, because a re-run is a genuine re-verification by
the seed curator, exactly like a curator re-saving the venue form.

## Attribution

Seeded data is not anonymous truth. Every venue's `created_by`, every
attribute's `verified_by`, and every `verification_events.curator_id` row
from an import is set to the curator named by `--curator`/`SEED_CURATOR_EMAIL`.
That curator must already exist in `curators` — add one first if needed (see
[docs/runbook/curators.md](runbook/curators.md)); the import aborts with a
clear error if the email doesn't resolve to an active row.

## Exit codes

- `0` — dry run with no errors, or a real import that completed (with or
  without `--force`).
- `1` — validation errors present and (`--dry-run` was passed, or `--force`
  wasn't and it's a real run), input file missing/empty, or no matching
  curator found.
