# ADR-APP-001 — Evolve investment-pal instead of building the multi-tenant platform

- **Status:** Accepted
- **Date:** 2026-08-17
- **Deciders:** Amir (product owner), implementation agent
- **Supersedes:** the separate `investment-os` new-repo / AIOS-CLAUDE-008 phase-plan build (now deferred)

## Context

Two parallel directions existed:

1. Build a new, multi-tenant **Investment OS** platform (`investment-os` repo) from the
   v1.1 Certified specification and the AIOS-CLAUDE-008 v1.2 phase plan — services,
   monorepo, event bus, broker abstraction, identity/tenancy.
2. Evolve the **existing live application** (`investment-pal`) — a working, single-user
   app with real portfolio data, live quotes, a committee prompt system, and a
   decisions table — by importing the OS program's *valuable capabilities* at
   single-user scale.

The multi-tenant platform is high-cost and duplicates a product that already works and
already runs on real money. The higher-value path is to make the live app the
self-improving decision loop the OS vision described.

## Decision

**Evolve `investment-pal`.** The separate `investment-os` platform build is **deferred**
(its Session-0 scaffold is archived for reference). The v1.1 Certified spec and v1.2
plan become a **read-only reference library** (concepts, contracts, governance
language) — not a build mandate.

Concretely:

- `github.com/majabri/investment-pal` is the **only** codebase. **No new repo. No
  monorepo/services restructure.** GitHub `main` is the single source of truth; Lovable
  deploys from it.
- Capabilities migrate in small, independently valuable PRs (branch → PR → merge),
  adapted to single-user context: price-history foundation → evidence contract on
  decisions → outcome grading → committee scorecard feedback → Swing Score →
  buy-back zones → IPS-lite.
- **Out of scope (do not build):** multi-tenancy, identity/roles, monorepo/services,
  Kubernetes/Terraform, event bus, broker abstraction beyond CSV import, paid data,
  and any restructure of existing working screens.

## Governance carried over (verbatim intent)

- **OD-001 governed co-spec:** where business logic is missing from the spec, propose
  it in the PR description as a mini-ADR under `docs/adr/`. **Money-adjacent logic**
  (margin math, position sizing, tax lots, anything moving toward real orders) requires
  Amir's **explicit line-item sign-off** before merge.
- **Evidence contract** is mandatory on material recommendations; **confidence ≠
  probability** (separate fields, never conflated).
- **Simulation/what-if never mutates live tables.** No silent self-modification —
  scoring-weight changes are explicit PRs with before/after rationale.
- **Live broker execution stays OFF — permanently out of scope.** The app recommends;
  Amir trades at Fidelity.
- When uncertain about anything affecting money, data integrity, or Amir's real
  accounts: **STOP**, file `docs/open-decisions/OD-xxx.md`, and ask.

## Consequences

- Fast, incremental value on the app people actually use; no platform rebuild.
- The v1.1 engines enter only as far as single-user capabilities require.
- If a true multi-tenant platform is ever needed, the archived `investment-os` scaffold
  and the spec remain available as a starting point.

## Reference

- Spec (read-only): `~/invest-os-intake/spec/` and Drive `My Drive/Projects/Invest IOS/`.
- Authority order: this instruction set → app operating rules (`AGENTS.md`, branch→PR→
  merge, `npm ci && npx tsc --noEmit` + boot check before merge) → reference-library
  concepts.
