# ADR-APP-019 — Backfilling `decisions.account_id` on pre-scope rows

- **Status:** Accepted (2026-09-18, Amir Jabri — decided in session, recorded by Claude Code)
- **Date:** 2026-09-18
- **Deciders:** Amir Jabri
- **Money-adjacent:** No — attaches an account label to historical decision rows; computes nothing.

## Context

`decisions.account_id` was added on 2026-09-03 and stamped by the Committee
write path from #226. Rows written before that have NULL, and DEC-005
(supersession) requires an account, so those rows cannot be superseded. The
gap matrix listed the backfill as the owner's call.

## Decision

**Backfill, deterministically.** A forward migration sets `account_id` on
NULL rows **only for a user who has exactly one account**, to that account.
A user with two or more accounts gets no backfill and the migration reports
the count of rows left NULL in its NOTICE; those rows stay as history. No
guess is ever written.

## Options considered

1. **Leave** — old rows stay unsupersedable. Honest, but the ledger's first
   weeks cannot be corrected through the supersession chain.
2. **Backfill to the user's only account** — deterministic; a wrong account
   is impossible when there is only one. **Chosen.**
3. **Backfill to the primary account** — needs a notion of "primary" the
   schema does not have, so it would be a guess.

## Consequences

- One idempotent migration with a schema test that seeds a one-account user
  and a two-account user and asserts only the former's rows move; applied by
  Lovable on request.
- The `record_change()` trigger fires on each backfilled row; the audit log
  and a `DecisionCreated`-free UPDATE event record the backfill honestly.
