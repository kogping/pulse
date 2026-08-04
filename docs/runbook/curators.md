# Curators

Console access is allow-list only — email magic link via Auth.js, no
passwords, no OAuth, no self-service sign-up. There is no roles system and
no invitations UI; the curators table in `packages/db` is the entire
identity model for the ~10 people who use the console.

## Add a curator

Insert a row into `curators` (`packages/db/src/schema/curators.ts`):

```sql
insert into curators (email, name, active, precinct_id, tier)
values ('name@example.com', 'Curator Name', true, 'newtown', 'standard');
```

`email` must be the address they'll request magic links with. `active`
gates sign-in — see below. `precinct_id` and `tier` are surfaced on their
session (`{ curatorId, precinctId, tier }`) for curator-facing UI to key off;
`precinct_id` may be `null` if they aren't scoped to one precinct.

## Deactivate a curator

Flip `active` to `false`. Do not delete the row — verification events and
correction flags attributed to them should keep resolving to a name.

```sql
update curators set active = false where email = 'name@example.com';
```

An inactive curator's magic-link requests still get the generic "check your
email" response (no account enumeration), but no email is sent and no
session is issued. Any existing session is invalidated on its next
DB-backed check (`getSessionAndUser` in `apps/console/lib/auth.ts`).

## Reactivate

Flip `active` back to `true`. No re-provisioning needed.
