# OD-003 — Which denominator the position and margin caps are enforced against

- **Status:** OPEN — needs the owner's line-item sign-off (OD-001)
- **Raised:** 2026-09-10
- **Area:** money-adjacent — position sizing, margin math, IPS thresholds
- **Serves:** P0-05, RISK-001 (audit brief 2026-09-10)

## Context

A position's weight can be a fraction of three different things, and `main`
divides by a different one on each screen:

| Where | Denominator | Printed as |
|---|---|---|
| `portfolio.tsx` holdings table | total account value (net equity) | `% of Acct` |
| `portfolio.tsx` sector bars | positions value (invested assets) | bare `%` |
| `index.tsx` constitution check (position cap) | total account value (net equity) | bare `%` |
| `index.tsx` constitution check (margin cap) | total account value (net equity) | bare `%` |
| `accountTotals.marginUtilisation` | gross assets | not rendered |
| `prompts.ts` holdings block | total account value (net equity) | `% of acct` |
| **`ADR-APP-004` C2** (the written policy) | **gross** | — |

Two consequences, both live:

1. **The written cap and the enforced cap are different numbers.** ADR-APP-004
   C2 states "max single-position weight 30% **gross**". The dashboard enforces
   30% of **net equity**. On a levered account those are far apart: with
   positions 80,000, cash 20,000 and a 30,000 debit, a 24,000 position is 24.0%
   of gross assets and 34.3% of net equity — a pass under the written policy and
   a breach under the enforced one, or the reverse as leverage changes.
2. **The committee was handed the mismatch.** `prompts.ts` tells the model
   "Max single position: N% of gross" and then lists each holding's weight
   computed against net equity. It was being asked to police a gross cap using
   net-equity numbers.

Margin utilisation has the same split: `accountTotals` defines it as debit ÷
gross, the enforced cap is debit ÷ net equity, and neither said so on screen.

## What has already been done (PR: labelled denominators)

Labelling only — **no arithmetic changed**, because changing it is
money-adjacent:

- `src/lib/concentration.ts` computes all three denominators from the one
  `accountTotals` arithmetic, with `known` / `unknown` / `zero` kept distinct.
- Every displayed percentage now names its denominator, in the UI and in the
  prompt — the holdings column heading, the sector bars, both constitution-check
  breach lines, and a per-position breakdown panel showing all three.
- The committee prompt change — each holding against **both** net equity and
  gross assets, each labelled, with each cap's denominator stated — is written
  and tested but held in a **separate PR**. The IPS block is the committee
  mandate, and labelling it correctly changes which positions the committee
  flags, so it needs the owner's line-item sign-off even though no threshold
  moves.
- `POLICY_DENOMINATOR` and `MARGIN_CAP_DENOMINATOR` record what `main` enforces
  today, in one place, so the decision below has a single site to land in.

## The decision needed

**A. The position cap's denominator.** One of:

- **Gross assets** — matches ADR-APP-004 C2 as written; the cap does not move
  when the margin debit changes; a levered account can hold a larger position
  for the same stated cap.
- **Net equity** — what `main` enforces today and what the broker statement's
  "% of Acct" column means; the cap tightens automatically as leverage rises,
  which is arguably the point of a concentration limit.
- **Invested assets** — measures concentration *within the portfolio*,
  independent of cash and leverage; a cash-heavy account is not flattered by its
  cash.

**B. The margin cap's denominator.** Debit ÷ net equity (today's enforcement),
debit ÷ gross assets (today's `accountTotals` definition), or a third
definition of the owner's choosing. It should not simply inherit A.

Note that B is the *narrower* of the two questions: ADR-APP-004 **C3** states
the margin cap as "25% **of account value**", and "account value" is defined in
the prompt's own data block as NET (investments + cash − margin). So the written
policy and the enforced code already agree on the margin cap — what is
unreconciled is `accountTotals.marginUtilisation`, a debit ÷ gross figure that
nothing renders and that no policy references. The conflict in **A** is the real
one: **C2 is the only line where the written policy and the enforced code
disagree.**

**C. Whether ADR-APP-004 C2 is amended, or the code is changed to match it.**
Whichever way A resolves, one of the two has to move. C2 was signed off as
"30% gross"; the dashboard has been enforcing 30% of net equity since it was
written, which on a levered account is the tighter of the two.

## Why this is not Claude's to decide

Position sizing and margin math are named in OD-001 and in `CLAUDE.md` as
requiring the owner's explicit line-item sign-off. Choosing A would change which
positions the app reports as breaching the owner's own risk policy, on a `main`
that deploys live. The audit brief asks for the answer to be recorded in an ADR;
that ADR is drafted separately and is not self-merged (ADR-APP-005 §2).

## Notes

- Whatever is chosen, the labels stay: a percentage that does not name its
  denominator is the defect, independently of which denominator wins.
- Unknown and zero denominators render the em-dash unknown state, never 0%.
