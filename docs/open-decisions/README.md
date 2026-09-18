# Open Decisions

An **OPEN-DECISION** captures a question the implementation must not answer on its own
because it affects **money, data integrity, or Amir's real accounts**, and the
reference spec doesn't settle it.

**Rule:** when you hit one, **don't infer.** File `OD-xxx.md` with context, options, and
a recommendation; stop on that path; ask in chat. Approved decisions graduate into an
ADR (`../adr/`) and/or code.

## Status index

| ID | Title | Status |
|---|---|---|
| OD-001 | Governed co-specification (missing logic → mini-ADR; money-adjacent needs line-item sign-off) | **Approved** |
| OD-002 | Free data sources only (Stooq / Yahoo daily closes; paid data is a Phase-2 gate) | **Approved** |
| OD-003 | Which denominator the position and margin caps are enforced against (net equity / gross assets / invested assets) | **Resolved 2026-09-18** — net equity (ADR-APP-013) |
| OD-004 | Whether the goal probability model should count monthly contributions (required CAGR does; the probability does not) | **Approved 2026-09-18** — label it (option 1) |
