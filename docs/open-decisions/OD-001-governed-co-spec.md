# OD-001 — Governed co-specification

- **Status:** Approved
- **Raised:** 2026-08-14 · **Reaffirmed:** 2026-08-17 (ADR-APP-001)
- **Amended:** 2026-09-10 (Amendment 1 — where the merge line sits)
- **Area:** scope / governance

## Context

The v1.1 Certified spec is architecture/governance-grade, not implementation-grade —
it defines contracts, principles, and governance, but leaves concrete business logic
(methods, formulas, thresholds) to implementation. Building the app requires filling
those gaps without silently inventing money-affecting rules.

## Decision (approved)

When business logic is missing from the reference spec:

1. **Propose it** in the PR description as a mini-ADR (or a file under `docs/adr/`):
   context, options, consequences, recommendation.
2. Get review before merge.
3. **Money-adjacent logic** — margin math, position sizing, tax lots, fee/cash
   handling, anything moving toward real orders — requires Amir's **explicit
   line-item sign-off** before merge. Storing/measuring is not the same as computing a
   trade; when in doubt, treat it as money-adjacent and ask.

## Amendment 1 — where the merge line sits (Amir, 2026-09-10)

Clause 3 said "any threshold/rate" and closed with "when in doubt, treat it as
money-adjacent and ask." Read literally that swept in changes that touch a field
carrying a rate without computing one, and PRs were stopping that had no money
math in them. PR #202 is the worked example: it stopped a stated target return
from being silently erased by a failed read. It computed nothing, moved no
threshold, and still tripped the clause — the letter of the rule reaching past
its purpose.

**The line is what a change PRODUCES, not what it touches.**

Sign-off is still required, and is not weakened, where a change computes or
alters a figure the owner would act on:

- position sizing and share counts
- margin math and margin thresholds
- tax lots
- cash and order math
- any threshold or rate **that the app itself computes, defaults, or applies**
- the committee mandate and the prompts carrying it

Sign-off is **not** required merely because a change handles, stores, displays,
validates or protects a value of that kind. Refactors, null-propagation and
coverage work, error-vs-empty distinctions, tests, accessibility, extraction and
UI wording are ordinary work, and Claude Code merges them on a green gate like
anything else — even where the value in the field is a rate.

The residual doubt clause stands, narrowed: when it is genuinely unclear whether
a change computes a figure, it is money-adjacent and stops. "Unclear whether it
computes one" is the test — not "a rate is nearby."

This does not touch ADR-APP-005 §2: **ADRs are still never self-merged**, and
the decisions inside `docs/adr/` remain the owner's regardless of who wrote the
file.

## Decision record

Approved and reaffirmed as the operating rule for the investment-pal track
(ADR-APP-001). Amended 2026-09-10 by Amir, in response to PR #202 stopping for
sign-off when it contained no money math: *"if pr are ready you should not wait
for me to merge them."*
