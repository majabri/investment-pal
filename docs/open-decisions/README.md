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
| OD-008 | Two conflicting `recommendation.schema.json` files in the certified repository | **Open** |
