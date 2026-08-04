# Kill switches (Vercel Edge Config flags)

Flags let us turn a feature off without a deploy — a Vercel Edge Config
write propagates in seconds and both `apps/web` and `apps/console` pick it
up on their next check (cached for at most 30s, see
`packages/config/src/flags.ts`).

Every flag has a safe default baked into the code. If Edge Config is
unreachable, misconfigured, or simply doesn't have a value for a key yet,
`getFlag()` returns that default — it never throws. So worst case, flipping
a flag in Edge Config does nothing and the app quietly falls back to the
default below.

## The flags

### `transport_live_enabled`
**Default: OFF.**
Gates live TfNSW departure countdowns on venue pages. When **off** (or
unreadable), the app shows the scheduled timetable with a "scheduled, not
live" label instead of a countdown — this is also what happens automatically
whenever live data is missing or stale, per the "degrade honestly" rule in
CLAUDE.md. Flip this off if the TfNSW feed is returning bad data (wrong ETAs,
stale timestamps) and we'd rather show nothing live than something wrong.

### `map_enabled`
**Default: ON.**
Gates the Mapbox GL map view on venue/precinct pages. When **off**, the map
is hidden entirely and pages fall back to list/text views — nothing else on
the page depends on it. Flip this off if Mapbox is erroring, rate-limited,
or a bad Mapbox token/billing issue is breaking page loads.

### `accessibility_filter_enabled`
**Default: OFF.**
Gates the accessibility filter control in venue search/browse. When **off**,
the filter control is hidden; it does not affect whether accessibility data
itself is shown on a venue. Flip this off if the underlying accessibility
attribute data is wrong or the filter is misbehaving (e.g. hiding venues it
shouldn't).

### `precinct_<id>_enabled` (dynamic, one per precinct)
**Default: OFF** for any precinct without an explicit value in Edge Config.
Gates whether a precinct appears in the app at all — search, browse, and
direct links all treat an unlaunched or disabled precinct as not existing.
`<id>` is the precinct's slug (e.g. `precinct_newtown_enabled`,
`precinct_cbd_enabled`). Use this to pull a precinct that has bad or
incomplete curator data, or to soft-launch a new one to nobody until it's
ready.

## How to flip a flag from your phone at 11pm on a Saturday

You need the Vercel mobile web dashboard (no app required) and to be logged
in as a team member with access to the `pulse-sydney` project.

1. On your phone, go to `vercel.com` and log in (or open a saved tab —
   do this once when sober so the session is already there).
2. Tap into the **pulse-sydney** project.
3. Tap **Storage** → the Edge Config store used by this project (there's
   only one — it's shared by both `apps/web` and `apps/console`).
4. Tap **Items** and find the flag key (e.g. `transport_live_enabled`). If
   it's not listed yet, tap **Add Item**, set the key to the exact flag
   name, and set the value.
5. Set the value to `true` or `false` (must be a real boolean, not the
   string `"true"` — a non-boolean value is treated as "unset" and the code
   default wins).
6. Save. The change is live within 30 seconds — no deploy, no redeploy, no
   waiting on CI.
7. Confirm: reload the affected page. For `transport_live_enabled`, check a
   venue page with departures — it should switch to/from "scheduled, not
   live". For `map_enabled`, check a venue page for the map. For
   `precinct_<id>_enabled`, search for a venue in that precinct.

If you can't get into Edge Config (locked out, dashboard down), the fallback
is: nothing — the code defaults above are exactly what you'd want in a "the
feature is misbehaving, make it stop" emergency (transport and accessibility
filter default off; map defaults on but is inert if Mapbox itself is down;
precincts default off). You are not stuck without a kill switch — you're
one bad login away from the same safe state the flag would put you in.
