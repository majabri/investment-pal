# ADR-APP-013 — Concentration denominators, and which one policy is enforced against

- **Status:** Proposed
- **Date:** 2026-09-10
- **Deciders:** Amir (product owner — line-item sign-off required), implementation agent
- **Money-adjacent:** **Yes** — position sizing and margin math. Nothing here takes
  effect until the owner signs off the line items in "Decision required" below (OD-001).
- **Serves:** P0-05, RISK-001 (audit brief 2026-09-10); resolves OD-003;
  amends or is amended by ADR-APP-004 C2

## Context

A position's weight is a fraction, and `main` has been using three different
denominators for it while printing all of them as `%`:

| Denominator | Definition | Used by |
|---|---|---|
| **Net equity** | cash + positions − margin debit (the broker's "total account value") | holdings table, position cap, margin cap, committee prompt |
| **Gross assets** | cash + positions, before the debit | `accountTotals.marginUtilisation` (rendered nowhere) |
| **Invested assets** | positions at market; cash excluded | sector allocation bars |

They are not close together. On positions 80,000 + cash 20,000 − debit 30,000,
a 24,000 position is:

- **34.3%** of net equity (70,000)
- **24.0%** of gross assets (100,000)
- **30.0%** of invested assets (80,000)

A single 30% cap therefore describes three different position sizes, and until
the labelling PR that accompanies this ADR, nothing on screen said which one was
being applied.

**ADR-APP-004 C2 states the position cap as "30% gross".** The dashboard has
been enforcing 30% of *net equity* since it was written. That is the one place
where the signed-off policy and the running code disagree — C3's margin cap
("25% of account value") already means net equity, which is what the code does.

The committee prompt carried the mismatch into the model's input: it stated the
cap as a fraction of gross and then supplied every holding's weight as a
fraction of net equity.

## What has already shipped (labelling only)

The accompanying PR changes no arithmetic. It adds `src/lib/concentration.ts`,
which computes all three denominators from the one `accountTotals` arithmetic
and keeps `known` / `unknown` / `zero` distinct, and it makes every displayed
percentage name its denominator on screen and in the prompt. It records today's
enforcement in `POLICY_DENOMINATOR` and `MARGIN_CAP_DENOMINATOR` so that this
decision has one site to land in rather than four.

The labels are not contingent on this ADR. Whichever denominator wins, an
unlabelled percentage remains the defect.

## Decision required

### D1 — the position cap's denominator

**Recommendation: net equity**, and amend ADR-APP-004 C2 to say so.

Reasoning: it is what the code already does, so nothing silently changes on a
`main` that deploys live; it is what the broker statement's own "% of Acct"
column means, so the app and Fidelity agree on screen; and it is the tighter of
the two on a levered account, which is the conservative direction for a
concentration limit — the cap tightens automatically as leverage rises, which is
arguably what a concentration limit is for.

Against it: the cap moves when the margin debit moves, so paying down margin can
put a position *over* a cap it was under, without the position changing. Someone
reading "30% gross" in ADR-APP-004 today is reading a rule the app does not
enforce, and has been for weeks.

| Option | For | Against |
|---|---|---|
| **Net equity** (today's code) | matches the broker's statement; tightens with leverage; no behaviour change on merge | moves with the debit; contradicts C2 as written |
| **Gross assets** (C2 as written) | stable against margin changes; matches the signed-off text | loosens exactly when leverage is highest; would immediately reclassify current breaches as passes |
| **Invested assets** | measures concentration *within* the portfolio; cash-neutral | a cash-heavy account looks more concentrated than it is; matches nothing already written |

### D2 — the margin cap's denominator

**Recommendation: net equity, explicitly — no change to behaviour**, and delete
or rename `accountTotals.marginUtilisation` (debit ÷ gross), which is a third
definition that nothing renders and no policy references.

Margin utilisation should not inherit D1's answer. It inherited the position
cap's denominator only because both were written inline in the same block.

### D3 — what happens to ADR-APP-004 C2

Whichever way D1 resolves, one of the two has to move: either C2 is amended to
match the code, or the code is changed to match C2. This ADR cannot do that on
its own authority — C2 is a signed-off money-adjacent line item.

## Consequences

- **If D1 = net equity:** ADR-APP-004 C2 is amended, the code is unchanged, and
  the breach set the user sees stays exactly as it is today. Lowest risk.
- **If D1 = gross assets:** positions currently flagged as breaches on levered
  accounts stop being flagged. That is a real loosening of the user's own risk
  policy and takes effect the moment it merges, live. It needs its own
  line-item sign-off, and the SESSION-LOG entry should say plainly which
  positions changed status.
- **If D1 = invested assets:** both the code and C2 change, and the figure stops
  reconciling against the broker's "% of Acct" column. Highest churn.
- In all three cases the labels stay, and the em-dash unknown state stays: an
  unknown or zero denominator renders as unknown, never 0%.

## Not decided here

Whether the position cap should become HARD (C2 is soft). Whether a specific
core holding can be whitelisted above the cap. Both are listed in ADR-APP-004 as
things that invalidate C2 and both are separate line items.
