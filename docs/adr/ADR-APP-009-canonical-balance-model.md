# ADR-APP-009 — The canonical balance model

- **Status:** Proposed
- **Date:** 2026-09-05
- **Deciders:** Amir (product owner)
- **Money-adjacent:** **Yes** — defines which figures may enter equity
- **Serves:** USER-AGNOSTIC FINANCIAL TRUTH & RECONCILIATION STANDARD, rules 7, 8, 28

## Context

`accountTotals.ts` documented its equity formula as *"Verified against Fidelity"*
on the basis of **one** real statement whose numbers happened to add up.

That is curve-fitting, not semantics. With enough fields, several wrong formulas
reproduce one sample. The formula may well be right; it had not been established
as right, and rules 6 and 8 prohibit exactly that reasoning.

Two attempts to establish the field definitions from the broker's own
documentation failed — the environment's egress proxy blocks `fidelity.com` and
the mirrored help content. **Recorded as blocked rather than filled in from
memory:** a remembered definition presented as the broker's is the class of
claim this work exists to remove.

## Decision

Every field carries a **semantic basis** saying what is actually known about it:

| Basis | Meaning | May enter equity? |
|---|---|---|
| `checked_identity` | participates in an identity checkable against other fields on the same statement | **yes** |
| `reported_scalar` | the broker reports it; nothing independently confirms what it means | no |
| `unsupported` | the meaning could not be established | no — excluded entirely |

**Exactly three fields came out `checked_identity`.** Everything else is stored,
displayed and kept out of every calculation.

Three consequences stated as rules:

1. **Buying power is not an asset** (rule 8). It is the broker's statement about
   what may be *borrowed*.
2. **Securities market value is not equity.** It is one term in an identity.
3. **Margin market value is not margin debt.** They are different quantities that
   a label makes look alike.

## Consequences

**Accepted:** the app computes less than it did. A field whose meaning cannot be
established is shown and excluded, so some figures a user can see on their
broker's page do not appear in any total here.

That is the intended trade. A smaller truthful app is worth more than a larger
one that is confidently wrong, and the previous behaviour — deriving equity from
whichever fields parsed — produced a number indistinguishable from a correct one.

**Reversible:** if a field's meaning is later established from primary
documentation, promoting it is one line plus its identity check.

## Alternatives rejected

- **Keep the working formula and note the uncertainty in a comment.** A comment
  does not stop the number being charted, reconciled and acted on.
- **Infer semantics from field names.** Rule 8 forbids it, and it is precisely
  how "margin market value" would become margin debt.

## Implementation

`src/lib/canonicalBalances.ts`, `src/lib/__tests__/canonicalBalances.test.ts`.
