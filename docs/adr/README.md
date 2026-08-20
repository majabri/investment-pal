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
