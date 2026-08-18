# OD-001 — Governed co-specification

- **Status:** Approved
- **Raised:** 2026-08-14 · **Reaffirmed:** 2026-08-17 (ADR-APP-001)
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

## Decision record

Approved and reaffirmed as the operating rule for the investment-pal track
(ADR-APP-001).
