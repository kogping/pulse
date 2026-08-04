# Spike: TfNSW Open Data as the F3 transport dependency

Ran `scripts/spike/gtfs-probe.ts` against the live API on **2026-08-04**. Raw
results in `scripts/spike/results/*.json`; fixtures in `test/fixtures/gtfs/`.

## 1. Approval lead time

Registered and approved **same day (2026-08-04)** — the portal issues a key
immediately on signup, no manual review observed. Key is live and in hand
(stored locally in `.env.local`, not committed). Treat this as the
optimistic case: no evidence of a slower manual-approval path for higher
tiers, so don't bank on same-day turnaround for a rate-limit increase if we
need one later — that goes through `opendataprogram@transport.nsw.gov.au`
and is unquantified.

## 2. Rate limits

**Documented** (Bronze/default plan, from the API Basics page):
- 5 requests/second throttle
- 60,000 requests/day quota
- Over-limit response documented as **HTTP 403** with header
  `X-Error-Detail: 'Account Over Rate Limit'`

**Observed** (`hammer` command against `v1/gtfs/realtime/ferries/sydneyferries`):
- Ramped concurrent bursts 1→9 req in a single wall-clock second each round.
- First throttle hit at **9 concurrent requests**, ceiling ≈ **8 req/s**.
- The throttle response was **HTTP 429**, not the documented 403 — the docs
  are wrong (or stale) on the status code. Code that backs off must handle
  both.

Budget math for launch: polling all 7 realtime feeds (see §5) every 15s from
a single server-side poller is 7 req / 15s ≈ 0.47 req/s sustained — an order
of magnitude under the observed ceiling — and 7 × 4/min × 60 × 24 ≈ 40,320
req/day, under the 60k daily quota but with less headroom than it looks once
static-bundle refreshes and manual debugging are added. **Client browsers
must never call TfNSW directly** — a single server-side poller writing to
Redis is required, both for the rate-limit budget and for invariant #6
(no per-user fan-out to a third party).

## 3. Licence and attribution

Data is licensed **CC BY 4.0**. The portal's [Data Licence](https://opendata.transport.nsw.gov.au/datalicence)
page states the obligation ("Transport for NSW is attributed as the
source") but does **not** publish an exact attribution string — it defers to
the general CC BY 4.0 legal code. There is no ready-made snippet to copy
into the UI.

Recommended string, pending confirmation from `opendataprogram@transport.nsw.gov.au`
before launch:

> Contains data based on Transport for NSW Open Data, licensed under a
> Creative Commons Attribution 4.0 licence (CC BY 4.0).

Action item: email TfNSW to confirm this is sufficient before this ships in
the footer — the licence obligation is real but the exact wording is our
best-effort interpretation, not a quoted requirement.

## 4. Static bundle size and parse time — fits a GitHub Actions runner?

Two per-mode bundles measured (there is **no single combined "all operators"
bundle behind a simple API path** — `/v1/gtfs/schedule/<mode>` is per-mode;
the all-operator zip is a web-only bulk download button per the portal, not
something the probe hit):

| mode | zip size | uncompressed | download | unzip | parse (line count) | total |
|---|---|---|---|---|---|---|
| buses | 93.7 MB | 505.2 MB | 15.9 s | 3.6 s | 1.8 s | 21.3 s |
| sydneytrains | 8.5 MB | 117.7 MB | 2.5 s | 0.7 s | 0.2 s | 3.4 s |

Buses is the worst case (all bus operators bundled, 3.6M stop_times rows,
92k trips). A standard `ubuntu-latest` GitHub Actions runner (14 GB SSD, 7 GB
RAM) swallows this without strain — 21s wall time and ~530MB of scratch disk
per run is nothing. Pulling all 7 mode bundles in one job would add up to
roughly 700MB–800MB uncompressed and well under a minute of wall time.
**Verdict: comfortably fits.**

## 5. Which realtime feeds cover the launch precincts' hubs

Confirmed live endpoints (all require `Authorization: apikey <key>`):

| feed | endpoint | notes |
|---|---|---|
| Buses (all operators) | `GET /v1/gtfs/realtime/buses` | one bundle, ~4.9 MB/poll, all bus operators |
| Ferries | `GET /v1/gtfs/realtime/ferries/sydneyferries` | |
| Light rail — CBD & South East | `GET /v1/gtfs/realtime/lightrail/cbdandsoutheast` | v1 |
| Light rail — Inner West | `GET /v2/gtfs/realtime/lightrail/innerwest` | **v2 only** — v1 path 404s |
| NSW TrainLink | `GET /v1/gtfs/realtime/nswtrains` | |
| Sydney Trains | `GET /v2/gtfs/realtime/sydneytrains` | **v2 only** — v1 superseded/404s |
| Metro | `GET /v2/gtfs/realtime/metro` | **v2 only** |

Between buses (all operators), Sydney Trains, Metro, and both light rail
lines, this covers every heavy-transit hub in the CBD, inner west, and inner
east precincts we're launching in. Ferries covers Circular Quay/Darling
Harbour. Nothing is missing for the launch footprint.

## 6. Realtime feed behaviour (buses, 10-minute sample)

- Payload: ~4.97 MB average (3,500–3,620 entities/poll).
- Decode (`gtfs-realtime-bindings`, protobuf → JS): **~53 ms average**,
  max ~95 ms. Cheap.
- Cadence: feed timestamp changed every **~15.4s median** across 34 changes
  in 10 minutes — matches the documented "every 15 seconds." One outlier gap
  of **61.5s** was observed once in the 10-minute window (an upstream
  stall, not a client-side miss). Build the "stale" detector in the
  freshness logic to tolerate single ~60s gaps before flagging, not just
  15s.

## Recommendation

**Full F3 at launch**, not timetable-only, with one hard requirement: a
single server-side poller (cron or long-lived worker in `syd1`) fetches all
7 realtime feeds on a ~15–20s cycle and writes normalized state to Redis;
app instances read from Redis, never from TfNSW directly. This is required
by the rate-limit math (§2) regardless of traffic, and it's also what makes
invariant #5 (degrade honestly — show scheduled timetable when live data is
missing/stale) implementable: the poller can flag a feed as stale after ~2
missed cycles (~30–40s, tolerant of the observed 61.5s gap) and the app
falls back to the static timetable rather than guessing.

Decode cost (~53ms) and payload size (~5MB worst case, buses) are both
trivial for a poller; they'd be a bad idea to run per-request from an
edge/serverless function, which is another reason to centralize.

Static bundles refresh once/day per TfNSW; pulling all 7 mode bundles in a
GitHub Action on a daily cron and diffing into Postgres is well within
runner limits (§4) and matches invariant #4 (migrations/data loads run from
GitHub Actions, never a Vercel build step).
