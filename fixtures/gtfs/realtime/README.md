# GTFS-R fixtures

The P0.5 TfNSW spike (`scripts/spike/gtfs-probe.ts`) is the tool that would
capture real GTFS-R trip-update payloads for regression fixtures, but no
capture from a live run has been checked into this repo yet — the spike's
`results/` output is gitignored scratch, not committed fixture data.

The `*.json` files here are synthetic stand-ins with the same shape TfNSW's
feeds actually use (confirmed against the spike's live probes): one
`FeedMessage.header.timestamp` plus a list of `TripUpdate` entities, each
with one `StopTimeUpdate` carrying a `stopId` and a `departure.time` unix
epoch. `countdown-accuracy.test.ts` loads them, encodes each into a real
GTFS-R protobuf buffer (`gtfs-realtime-bindings`), and decodes that buffer
back through the same `decodeLiveFeed` the production route handler uses —
so the protobuf encode/decode path is exercised for real, only the capture
itself is synthetic rather than recorded off the live TfNSW endpoint.

Replace these with genuine recordings (`pnpm spike:gtfs-probe realtime
<feed> --minutes=10`, saved and trimmed to a single relevant entity) the
next time someone captures a live session — the loader and test don't care
which kind of file they're reading.
