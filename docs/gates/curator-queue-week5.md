# Curator queue — week 5 live gate

> **STATUS: PENDING — gate NOT met.**
> Phase 2 feature work must not start until both runs below are filled in
> with real results and the pass/fail criteria are met. If a run fails,
> fix the friction it surfaces before re-running — do not relax the
> criteria.

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

## Run 1 — PENDING

- Curator:
- Date:
- Precinct:
- Venue(s):
- Phone / OS / browser:
- Carrier / signal bars at start:
- Start time / end time:
- Total elapsed (item 1 shown → pending count 0):

| # | attribute | confirm or correct | taps | seconds |
|---|-----------|---------------------|------|---------|
| 1 | PENDING   |                     |      |         |
| 2 |           |                     |      |         |
| 3 |           |                     |      |         |
| 4 |           |                     |      |         |
| 5 |           |                     |      |         |
| 6 |           |                     |      |         |
| 7 |           |                     |      |         |
| 8 |           |                     |      |         |
| 9 |           |                     |      |         |
| 10|           |                     |      |         |
| 11|           |                     |      |         |
| 12|           |                     |      |         |
| 13|           |                     |      |         |
| 14|           |                     |      |         |
| 15|           |                     |      |         |
| 16|           |                     |      |         |
| 17|           |                     |      |         |
| 18|           |                     |      |         |
| 19|           |                     |      |         |
| 20|           |                     |      |         |

**Friction log:**

- PENDING

**Result:** PENDING

---

## Run 2 — PENDING

- Curator:
- Date:
- Precinct:
- Venue(s):
- Phone / OS / browser:
- Carrier / signal bars at start:
- Start time / end time:
- Total elapsed (item 1 shown → pending count 0):

| # | attribute | confirm or correct | taps | seconds |
|---|-----------|---------------------|------|---------|
| 1 | PENDING   |                     |      |         |
| 2 |           |                     |      |         |
| 3 |           |                     |      |         |
| 4 |           |                     |      |         |
| 5 |           |                     |      |         |
| 6 |           |                     |      |         |
| 7 |           |                     |      |         |
| 8 |           |                     |      |         |
| 9 |           |                     |      |         |
| 10|           |                     |      |         |
| 11|           |                     |      |         |
| 12|           |                     |      |         |
| 13|           |                     |      |         |
| 14|           |                     |      |         |
| 15|           |                     |      |         |
| 16|           |                     |      |         |
| 17|           |                     |      |         |
| 18|           |                     |      |         |
| 19|           |                     |      |         |
| 20|           |                     |      |         |

**Friction log:**

- PENDING

**Result:** PENDING

---

## Sign-off

- [ ] Run 1 passes all four criteria above
- [ ] Run 2 passes all four criteria above
- [ ] Any friction noted in either run has been triaged (fixed, or
      explicitly deferred with a reason recorded here)
- [ ] Gate status updated to MET, with both runs' dates and curators named

**Gate status:** PENDING
