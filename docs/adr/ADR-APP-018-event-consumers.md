# ADR-APP-018 — How `domain_events` are consumed

- **Status:** Accepted 2026-09-18 — option 2, per-consumer cursor (Amir Jabri, in chat: "3 is cursor")
- **Date:** 2026-09-18
- **Deciders:** Amir Jabri
- **Money-adjacent:** No — plumbing for follow-up work; no figure is produced.

## Context

`domain_events` (#233) is a durable outbox: the trigger `record_change()`
writes one row per material change, fourteen §19.1 names. It has one
`consumed_at` column. Nothing consumes yet (#241 reads it for the activity
panel and touches nothing). The blueprint's v1 list names three consumers:
rerank on `TrancheClosed` (waits on the universe ranking), outcome
measurement on `DecisionCreated`, cache invalidation on `GoalChanged`.

The shape question: **whoever sets `consumed_at` first hides the event from
every later consumer.** A cache-invalidation consumer marking `GoalChanged`
consumed would hide it from the goal-change cascade. That is a design fault
waiting to happen, and it is cheaper to decide now than after the first
consumer ships.

## Options

1. **One consumer owns the column.** A single in-app dispatcher reads
   unconsumed events, fans them out to every handler, then sets
   `consumed_at`. Simple; no migration. Every future handler must live inside
   the dispatcher, and a handler that fails leaves the event either unconsumed
   for all (retry storms the ones that succeeded) or consumed for all (the
   failed one is lost).
2. **A per-consumer cursor.** A small table `event_consumers(name, last_event_id,
   updated_at)`; each consumer reads events with `id > its cursor`, handles
   them, advances its own cursor. `consumed_at` is dropped or kept as "seen by
   at least one". One forward migration with its schema test; consumers are
   independent and retry independently. **Recommended.**
3. **A `consumed_by TEXT[]` on each event.** Each consumer appends its name.
   No new table, but an array the trigger must not touch and a query that
   grows with the consumer list; harder to index.

## Recommendation

Option 2. It costs one migration now and avoids a rewrite the day the second
consumer arrives. The first consumer would then be the cheapest honest one:
`GoalChanged` → invalidate the goal-derived caches in every open tab, with
its cursor advanced; a proof of the mechanism before outcome measurement
moves onto it.

## Consequences (if 2)

- Migration: `event_consumers` table, RLS per user, seed rows none; the
  replay test asserts a consumer's cursor advances only past events it read.
- `consumed_at` is left in place, set by the dispatcher when every registered
  consumer has passed an event, so the activity panel's "consumed" reading
  keeps a meaning.

## Decision (2026-09-18)

Amir Jabri, in chat, with the three options and their consequences in front
of him: **option 2, the per-consumer cursor** — *"3 is cursor"*.

Executed the same day in `20260918210000_event_consumers.sql` (PR "Per-consumer
cursors over domain_events"): `event_consumers (user_id, name, last_event_id)`
with a SELECT-only policy; `register_event_consumer(name)` starts a new
consumer at the owner's latest event; `advance_event_cursor(name, id)` never
moves backwards or past an event that exists, then sets `consumed_at` on the
events every registered consumer has passed (the minimum cursor). The client's
direct `UPDATE (consumed_at)` is revoked: the function is the one writer. No
consumer is registered by the migration. The first consumer — `GoalChanged` →
the goal-derived caches — is wired in the app after Lovable applies the
migration and regenerates the types.

One refinement to the consequences above: a consumer that registers starts at
the present and passes the history before it by declaration. A consumer that
wants history (outcome measurement) is seeded at the cursor it wants by its
own migration, not by replaying everything.
