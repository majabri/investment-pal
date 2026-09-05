# ADR-APP-010 — The broker adapter contract

- **Status:** Proposed
- **Date:** 2026-09-05
- **Deciders:** Amir (product owner)
- **Money-adjacent:** No — governs where interpretation lives, not what any figure is
- **Serves:** USER-AGNOSTIC FINANCIAL TRUTH & RECONCILIATION STANDARD, rules 3, 8

## Context

One broker's interpretation was spread across the parser, the totals engine, the
UI copy and the prompts. Rule 3 asks that a second broker be addable **without
touching portfolio logic**, and there was no way to tell whether that held.

The Phase 8 audit found **21 places** the broker's name reached the user, and one
where it reached a model: the committee mandate instructed *"Ignore all other
Fidelity accounts"*, asserting the user's broker to the thing being asked for
advice.

## Decision

**One file per broker, satisfying one type.**

```ts
type BrokerAdapter = {
  id: string;           // stable, stored as provenance
  displayName: string;  // for people
  canRead(raw: string): boolean;
  read(raw: string, asOf?: Date): AdapterResult;
};
```

Four properties, each with a reason:

1. **`read` is ONE method**, not `parse` / `validate` / `map`. Three methods let a
   caller skip validation and still get a canonical record; one cannot be
   half-used.
2. **`canRead` is conservative.** `false` means "someone else should try". An
   adapter claiming text it cannot read is worse than no adapter, because it
   produces a *confidently empty* record instead of an unhandled one.
3. **`asOf` is when the figures were TRUE**, not when they were read.
4. **Findings are data, not exceptions.** `identity_failed`, `out_of_range`,
   `unsupported_field` — a broker's own printed identity failing is the strongest
   available signal that a field is being read as something it is not, and it must
   reach the user rather than a log.

**Broker knowledge is confined to the adapter.** Its comments may document a
format; nothing outside may assume one. User-facing copy says "your broker".

## Consequences

**Accepted:** adding a broker means writing an adapter, not extending a parser.
The contract is proven by a **synthetic second-broker fixture** in the tests —
different field names, a different sign convention on margin debt, one field the
contract marks unsupported — rather than asserted in a comment.

**Accepted:** copy is slightly less specific. "Your broker's balances page" is
vaguer than "Fidelity → Balances → Cash & Credits" for a user who does bank at
Fidelity. The alternative tells every other user something false.

## Implementation

`src/lib/adapters/contract.ts`, `src/lib/adapters/fidelity.ts`,
`src/lib/__tests__/adapterContract.test.ts`.
