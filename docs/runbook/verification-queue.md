# Using the verification queue

A quick guide for curators. If something here doesn't match what you see in
the app, tell an admin — this doc should track the real thing.

## What it's for

Every attribute on the site (queue length, cover charge, dress code, etc.)
has a "confidence" — fresh, ageing, or unconfirmed — based on how long ago
someone last checked it. There's no automatic refresh. The queue is the only
way that confidence gets reset, so clearing it regularly is what keeps the
site honest.

## Opening it

1. Go to the console on your phone: **console.pulse.sydney** (or whatever
   URL an admin gave you).
2. Sign in with your email — you'll get a magic link, no password.
3. Tap **Queue**.

You'll see up to 20 items for your precinct, oldest-checked first. Anything
flagged by a visitor as "looks wrong" jumps to the front.

## Resolving an item

Each item shows one venue and one attribute, with its current value, e.g.

> **The Velvet Room**
> Cover charge: $15 after 9pm

You have two options:

- **Still right** — one tap. Use this if the value is still accurate. Done,
  next item.
- **Correct** — tap this if the value has changed. It opens a small control
  for that attribute (buttons to pick from, or a box to type/pick a new
  value). Pick or enter the new value, then tap **Submit**. That's it — at
  most three taps total.

The app moves to the next item immediately — no waiting, no page reloads.

## Undo

After you resolve an item, a small banner pops up for 5 seconds with an
**Undo** button. Tap it if you made a mistake. After 5 seconds it locks in
and the banner disappears — you can't undo from there, so double-check
before you tap "Still right" or "Submit" on something you're unsure of.

## Working with bad signal

The queue is built for this. If your connection drops:

- Everything still works — taps register immediately and are saved on your
  phone.
- A **pending** counter appears at the top showing how many items are
  waiting to sync.
- Once you're back on signal, they send automatically. You don't need to do
  anything or retry.

If the counter says "sign in to sync," your session has expired — sign in
again and it'll pick up where it left off. Nothing you did is lost.

## Tips

- Work through items in order — the oldest and flagged ones matter most.
- If you're not sure what changed, "Correct" and take the extra second — a
  wrong guess is worse than leaving it for someone else.
- The queue refills from what's stale in your precinct, so there's no
  "finishing" it for good — clearing it to zero for today is the goal.
