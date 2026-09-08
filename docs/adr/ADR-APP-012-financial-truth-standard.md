# ADR-APP-012 — Adopting the financial truth & reconciliation standard

- **Status:** Proposed
- **Date:** 2026-09-05
- **Deciders:** Amir (product owner)
- **Money-adjacent:** **Yes** — it governs every money-adjacent decision that follows
- **Serves:** all 37 rules

## Context

On 2026-09-05 an unattended run shipped real personal financial data to a public
repository and nobody noticed for two days. The remediation removed the data. It
did not remove the class of defect, which was never really about privacy:

**the app could not say "I don't know."**

Not for a balance, not for an objective, not for what an account is, not for how
old a figure is, not for whether a source had been read. Every gap was filled
with a number, and every filled gap looked exactly like a fact.

## Decision

Adopt the **USER-AGNOSTIC FINANCIAL TRUTH & RECONCILIATION STANDARD** (37 rules)
as permanent build rules for this repository, superior to any brief.

Five that carry the rest:

- **Rule 13 — unknown is not zero.** Enforced in the schema first: a column that
  cannot express absence guarantees every layer above it fabricates.
- **Rule 8 — never infer accounting from a label.** A field name, an account
  name, a ticker and a broker's status string are all labels.
- **Rule 15 — a default must be labelled a default** and must never masquerade as
  a preference.
- **Rule 18 — AI is downstream.** A model may analyse and recommend; it may never
  be the source of a financial figure.
- **Rule 37 — a second user, end to end, with no source changes.** Until that
  passes, the architecture is not complete.

### Two practices this work established, worth keeping

**1. Every guard needs a negative control.** A guard that matches nothing passes
forever. This program caught **nine** instances of a guard being coarser or
plainly wronger than the fault it named — including several that fired on their
own explanatory comment, and one whose claim about the code was simply false and
failed on its first run.

*A guard that fires on the explanation pressures the next person to delete the
explanation.* Strip comments before matching, and write the control first.

**2. Making something configurable makes its empty case reachable for the first
time.** Three separate rule-13 bugs surfaced this way: `[].reduce(…, 0)`
returning `0` against a $600,000 target; `/ Math.max(1, mv)` scoring an empty
account "0% in approved names"; `ageOf` returning `NaN` for a missing birth date.
All three were unreachable *only* because a hardcoded constant guaranteed the
input was never empty.

## Consequences

**Accepted:** the app shows "Unavailable" in more places, and refuses to produce
some recommendations it previously produced. Screens are empty until configured.
That is the standard working, not a regression — **an empty screen that says what
is missing is not a regression from a full screen that is wrong about whose money
it is.**

**Accepted:** schema changes are forward-only and none backfills a value. Fifteen
migrations are pending as of this ADR; the app cannot express most of what has
moved into data until they are applied.

**Accepted:** money-adjacent work merged under a standing instruction rather than
line-item sign-off (OD-001). Each such PR states so in its body rather than
merging silently. **This ADR does not ratify that retroactively** — it records it
so the decision is visible.

## What is NOT decided here

- **Git history.** Everything the remediation removed is still reachable in it.
  Removing it means `git filter-repo` and a force-push, which §5 of the P0 brief
  reserves for Amir and which this repository's rules forbid an agent from doing.
- **Live broker execution.** Permanently out of scope (ADR-APP-001).
- **A rate provider for FX.** Rule 32 asks for the architecture; inventing a rate
  source would be worse than having none.

## Implementation

Phases 0–8, PRs #131–#171. `docs/implementation/SESSION-LOG.md`,
`docs/audit/REPOSITORY-AUDIT-2026-09-05.md`.
