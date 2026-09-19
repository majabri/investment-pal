# ADR-APP-022 — Per-account policies; no leverage for family strategies

- **Status:** Proposed <!-- for Amir; drafted 2026-09-19 -->
- **Date:** 2026-09-19
- **Deciders:** Amir Jabri
- **Money-adjacent:** Yes — which caps apply to which account, and whether an account may borrow. No arithmetic changes; what changes is which rule a figure is checked against.

## Context

BR-003 / BR-011: family (kids') strategies never use leverage; policies are
per account, not per user. Today `ips_lite` is one row per user (position
cap, margin cap, margin rate, caps source) and the Constitution Check reads
it for whichever account is on screen. A kids account is therefore checked
against the same margin cap as the brokerage account, and nothing in the
schema says it may not borrow at all.

## Options

1. **`account_policies (account_id PK, no_leverage boolean, position_cap_pct,
   margin_cap_pct, caps_source, effective_at)`, falling back to `ips_lite`
   when no row exists.** The Constitution Check takes the account's policy;
   `no_leverage = true` makes any margin debit a breach and hides the margin
   meter's "cap" reading behind "no leverage permitted". Family strategies
   are seeded `no_leverage = true` by the owner on `/settings`, not by code
   guessing from an account's name.
2. **A `no_leverage` flag on `accounts` only.** Smaller; leaves per-account
   caps for later, and the cap denominators (ADR-013) already differ by
   account value, so a per-account cap is the natural next ask.
3. **Leave `ips_lite` per user.** BR-011 stays a prompt instruction, which
   the blueprint's own rule (CONST-005) says is not an implementation.

## Recommendation

**Option 1**, with the fallback stated on screen ("household policy applies;
no account policy set") so an account under the household caps is never
mistaken for one with its own. Consequences: one migration with schema and
RLS tests; `constitutionCheck` takes a `PolicyLike` per account (the
structural type already exists); `/settings` gains a per-account policy
editor; the brief carries which policy the checks used. Which accounts are
"family" is the owner's entry, never inferred.

## Decision

<!-- Amir -->
