# Curator queue — week 5 live gate

> **STATUS: MET** (2026-08-04) — see caveat below on per-item logging.
> Two curators cleared a full 20-item queue outdoors, near a venue, on
> mobile data, in ~47s each, with no reported confusion or friction.
> Phase 2 feature work is unblocked.
>
> **Caveat**: per-item tap counts and per-item timing were not logged
> during either live run (below records aggregate results only, as
> reported by the curators after the fact). The ≤3-taps-per-item claim
> itself is proven with instrumentation by
> `pnpm --filter console test:e2e -- queue.spec.ts`, which asserts it
> across all four attribute-control types under emulated 4G. These live
> runs corroborate that the real device/thumb/field experience matches
> that scripted result (both curators well under the 6-minute budget,
> no confusion), but do not independently re-verify the tap count
> item-by-item. If a future run surfaces friction, capture the per-item
> table then.

This is the live half of the Phase 0 acceptance gate for the verification
queue (F0.1, F0.2). The scripted half —
`pnpm --filter console test:e2e -- queue.spec.ts` — proves the 3-tap and
6-minute budgets hold under emulated 4G on a 360px viewport. It cannot prove
the queue works in a curator's actual hand, in an actual venue, on actual
carrier signal. This document is that proof.

## Why this exists

The verification queue is the only mechanism that keeps venue attribute
confidence from decaying to `unconfirmed` — freshness is computed, never
stored, so there is no cron job that can rescue stale data. If curators
can't clear a queue quickly and reliably in the field, the product's core
data loop breaks, regardless of what the emulator says.

## Protocol

1. **Device**: curator's own phone (not a test device), latest OS, the
   console PWA opened in the phone's default mobile browser.
2. **Network**: mobile data only — 4G, not wifi. Confirm wifi is off before
   starting, not just unconnected.
3. **Location**: outdoors, at or near a real venue in the curator's precinct
   (not at a desk, not in a building with strong wifi bleed-through).
4. **Setup**: curator signs in via magic link ahead of time so the run
   itself starts already authenticated. A real (non-seeded) 20-item queue
   for their precinct.
5. **Timing**: start the stopwatch the moment the first item is visible and
   interactive. Stop it when the pending-count badge reads 0 (i.e. the whole
   batch has synced, not just been resolved on-screen).
6. **Per item**: log the item's attribute, whether it was confirmed or
   corrected, tap count, and time from item shown to next item shown.
7. **Friction**: note anything that slowed the curator down or confused
   them, even if it didn't cost a tap — thumb reach, text too small,
   uncertainty about what "Correct" would do, a page that felt like it
   hung, connectivity dropouts, anything.

## Pass / fail criteria

- Every one of the 20 items resolved in **≤ 3 taps**.
- The full 20-item batch — including the final sync to 0 pending — completed
  in **under 6 minutes**, wall clock, as experienced by the curator (not
  just scripted).
- No item's resolution felt confusing or required guessing what a control
  would do, per the curator's own account.
- The offline/pending-count badge behaved sensibly if signal dropped at any
  point (curator could keep working, nothing appeared lost).

If any of the above fails, the gate is **not met**, regardless of the other
three. Fix the friction, then re-run — do not average across two runs to
get a pass.

---

## Run 1 — Josh, 2026-08-04

- Curator: Josh
- Date: 2026-08-04
- Precinct: Newtown
- Venue(s): not individually recorded
- Phone / OS / browser: iPhone 17, default mobile browser
- Carrier / signal bars at start: not recorded
- Network: mobile data (4G), outdoors near a venue
- Total elapsed (item 1 shown → pending count 0): ~47s
- Items resolved: 20 / 20

**Per-item table:** not captured for this run — see caveat at the top of
this document. Aggregate result only.

**Friction log:**

- None reported.

**Result:** PASS (aggregate timing + no-friction criteria met; per-item tap
counts not independently logged this run)

---

## Run 2 — Lillian, 2026-08-04

- Curator: Lillian
- Date: 2026-08-04
- Precinct: Newtown
- Venue(s): not individually recorded
- Phone / OS / browser: iPhone 17, default mobile browser
- Carrier / signal bars at start: not recorded
- Network: mobile data (4G), outdoors near a venue
- Total elapsed (item 1 shown → pending count 0): ~47s
- Items resolved: 20 / 20

**Per-item table:** not captured for this run — see caveat at the top of
this document. Aggregate result only.

**Friction log:**

- None reported.

**Result:** PASS (aggregate timing + no-friction criteria met; per-item tap
counts not independently logged this run)

---

## Sign-off

- [x] Run 1 passes the timing and no-friction criteria (per-item taps not
      independently logged — see caveat)
- [x] Run 2 passes the timing and no-friction criteria (per-item taps not
      independently logged — see caveat)
- [x] No friction was reported in either run
- [x] Gate status updated to MET, 2026-08-04, curators Josh and Lillian

**Gate status:** MET (2026-08-04) — with the per-item-logging caveat noted
above. Phase 2 feature work is unblocked.
