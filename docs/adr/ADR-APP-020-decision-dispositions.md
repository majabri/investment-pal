# ADR-APP-020 — Decision dispositions: Defer and Mark Executed

- **Status:** Proposed <!-- for Amir; drafted 2026-09-19 -->
- **Date:** 2026-09-19
- **Deciders:** Amir Jabri
- **Money-adjacent:** No — a vocabulary for what the owner did with a recommendation; no figure is produced.

## Context

§5.3 / §22.1 (UX-001): the action sheet offers, per recommendation, Accept /
Reject / Defer / Mark Executed, and nothing executes silently. Today
`decisions.decision` holds `pending`, `followed`, `modified`, `rejected`
(`DecisionCard`). Two of the blueprint's four are missing:

- **Defer** — "not now, keep it in front of me": distinct from `pending`
  (never looked at) and from `rejected` (looked at, declined).
- **Mark Executed** — "I placed it at the broker": the one disposition that
  should link to an order (`orders.decision_id`, since #233), so the §A.3
  chain decision → order → fill is a foreign key rather than a reconstruction.

There is no CHECK on the column; the vocabulary is held by the app. The
matrix left this for the owner because ADR-APP-008 (Amendment 1: the seven
action verbs) settled what a recommendation can SAY, not what the owner can
DO with it, and a disposition vocabulary is the same kind of decision.

## Options

1. **Add `deferred` and `executed`; `executed` requires an order.** Marking
   executed without an order id is refused at the write; the card offers a
   picker over the account's orders (or "record the order first"). Stored
   history untouched. One small migration to add a CHECK naming all six, with
   the schema test.
2. **Add both, order optional.** Cheaper to use, but "executed" with no
   order is a claim the ledger cannot check — the state UX-001 exists to
   prevent.
3. **Leave the four.** The sheet keeps offering less than the blueprint says.

## Recommendation

**Option 1.** It is what UX-001 asks for and it costs one column CHECK and a
picker. Consequences: `DecisionCard` gains two buttons; `assertAiWritable`
unchanged (the owner writes, not the model); the readiness of a decision is
not affected; the scorecard treats `executed` as `followed` for hit-rate
until §13.1's outcome horizons exist.

## Decision

<!-- Amir -->
