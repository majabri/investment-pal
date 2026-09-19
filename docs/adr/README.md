# Architecture Decision Records (ADRs)

Short records of significant, hard-to-reverse decisions and the reasoning behind them.
In this app, ADRs are how we add concrete design decisions on top of the Investment OS
reference library (per **OD-001**: where the spec lacks business logic, we propose it —
here, in an ADR / the PR description — and get sign-off before merge).

## Numbering

- `ADR-APP-00x` — decisions for **this application** (`investment-pal`).
- Spec ADRs (`AIOS-ADR-00x`) live in the read-only reference library and are cited, not
  copied.

## Lifecycle

`Proposed → Accepted → (Superseded | Deprecated)`

1. Copy `ADR-TEMPLATE.md` to `ADR-APP-00x-short-title.md`, or write the mini-ADR
   directly in the PR description for small decisions.
2. **Money-adjacent logic** (margin math, position sizing, tax lots, anything moving
   toward real orders) requires Amir's **explicit line-item sign-off** before the ADR
   is Accepted / the PR is merged (OD-001).

## When a decision is still open

If it affects money, data integrity, or Amir's real accounts and the spec doesn't
settle it: **don't infer.** File `../open-decisions/OD-xxx.md` and ask in chat.

## Index

| ADR | Title | Status |
|---|---|---|
| ADR-APP-001 | Evolve investment-pal instead of building the multi-tenant platform | Accepted |
| ADR-APP-002 | Swing Score (advisory trim signal) | Accepted |
| ADR-APP-003 | Buy-back zones (re-entry ladder after a trim/sell) | Accepted |
| ADR-APP-004 | IPS-lite (single-user policy record) | Accepted |
| ADR-APP-005 | Standing merge policy (self-merge authority) | Accepted |
| ADR-APP-006 | Server-function access controls and input limits | Accepted |
| ADR-APP-007 | The margin rate is IPS policy, and unset suppresses | Accepted |
| ADR-APP-008 | Canonical recommendation contract and its divergences | Accepted |
| ADR-APP-009 | The canonical balance model | Accepted |
| ADR-APP-010 | The broker adapter contract | Accepted |
| ADR-APP-011 | The reconciliation engine | Accepted |
| ADR-APP-012 | Adopting the financial truth & reconciliation standard | Accepted |
| ADR-APP-013 | Concentration denominators (D1–D3 decided: net equity) | Accepted |
| ADR-APP-014 | Lovable's direct-to-`main` write path | Accepted |
| ADR-APP-015 | Navigation information architecture | Proposed |
| ADR-APP-016 | Fill to holding: a reconciliation view, never a projection | Accepted |
| ADR-APP-017 | Who writes the investment universe | Accepted |
| ADR-APP-018 | How `domain_events` are consumed | Accepted (2026-09-18: per-consumer cursor) |
| ADR-APP-019 | Backfilling `decisions.account_id` on pre-scope rows | Accepted |
| ADR-APP-020 | Decision dispositions: Defer and Mark Executed (UX-001) | Proposed |
| ADR-APP-021 | Model registry and calculation registry (CONST-007, DATA-006) | Proposed |
| ADR-APP-022 | Per-account policies; no leverage for family strategies (BR-003, BR-011) | Proposed |
