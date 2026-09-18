# ADR-APP-016 — Fill to holding: a reconciliation view, never a projection

- **Status:** Accepted (2026-09-18, Amir Jabri — decided in session, recorded by Claude Code)
- **Date:** 2026-09-18
- **Deciders:** Amir Jabri
- **Money-adjacent:** No — it compares recorded fills with imported holdings and flags differences. It computes no position, order or cash figure and changes no stored holding.

## Context

Recording a fill (#216) changes nothing about the holding it belongs to. That
was deliberate: the Fidelity import is the holding's source of truth
(DATA-004), and a fill that silently moved a position would put a quantity on
screen that Fidelity had not confirmed. The gap matrix's ORD-001 row asked
which of two shapes the fill → holding relationship should take.

## Decision

**Option (a).** Holdings change only by import. The app shows, per symbol, the
fills recorded since the last import beside the change the import produced,
and **flags** a fill that does not explain the delta and a delta that no fill
explains. Nothing is applied; the flag is the product.

## Options considered

1. **(a) Reconciliation view** — Fidelity stays authoritative; a wrong or
   duplicate fill is caught at the next import rather than propagated. Slower
   to reflect a trade on screen (until the next import). **Chosen.**
2. **(b) Projection** — a fill immediately moves the holding to an expected
   quantity that the next import confirms or corrects. Faster on screen; the
   app can show a position Fidelity does not, and a fat-fingered fill is live
   until corrected.

## Consequences

- A new pure module joins fills to holdings by symbol and account over the
  window since `accounts.last_synced_at`; a view module writes the sentences;
  a panel on `/portfolio` renders them. §26.2 test 8 ("a cancelled or
  untriggered order never becomes a holding") stops being vacuous: such an
  order contributes nothing to the expected delta.
- `orders.filled_quantity` remains the broker's claim and fills the evidence
  (`reconcileFills`); this view is the third leg, fills against holdings.
