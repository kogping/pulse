## Summary

<!-- What does this PR do and why? -->

## Standing Context invariants

Check every box that applies, or explain in a comment why it doesn't apply to this change.

- [ ] **Region** — every Vercel function this PR touches runs in `syd1` (`vercel.json` has `{"regions": ["syd1"]}`); no function runs elsewhere.
- [ ] **Freshness is computed, never stored** — no new `confidence` column, no cron job that flips attribute state; confidence stays a pure SQL function of `(attribute_key, last_verified_at, flag_count, now())`.
- [ ] **No bare badge values** — any API returning a venue attribute returns `{ value, confidence, lastVerifiedAt }` or `{ confidence: 'unconfirmed' }`, enforced by a discriminated union.
- [ ] **Migrations run from GitHub Actions, never a Vercel build step** — expand/contract only; destructive changes are split across a two-PR sequence.
- [ ] **Degrade honestly** — when live transport data is missing, stale, or errored, this PR shows the scheduled timetable with a "scheduled, not live" label rather than a possibly-wrong countdown.
- [ ] **No precise location persistence** — coordinates are used in-request only and discarded; at most precinct + geohash-5 is persisted; web sessions remain anonymous rotating hashes.

## Test plan

<!-- How did you verify this change? Include the exact command(s) run. -->
