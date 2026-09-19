# ADR-APP-021 — Model registry and calculation registry

- **Status:** Proposed <!-- for Amir; drafted 2026-09-19 -->
- **Date:** 2026-09-19
- **Deciders:** Amir Jabri
- **Money-adjacent:** No — provenance for figures, not figures.

## Context

CONST-007 / §14.3: every major model has a version, an evaluation history, a
rollback path and confidence semantics. DATA-006 / §17.5: every derived value
identifies its calculation version and inputs. Today:

- `decisions.model_version` is stamped (#226) with the **provider's model
  id** (e.g. the chat model's own name); nothing says which prompt
  contract, which policy and which data readiness went with it beyond the
  three sibling columns; nothing lists the versions that have ever run.
- Derived figures carry a name, not a version — except the universe ranking
  (`rank-v1` / `rank-v2`, #268 and the rerank migration), which is the first
  figure to say which rule produced it.

Both registries are schema. The matrix put them at P2 because nothing today
reads them; what they buy is the ability to group outcomes by version
(LEARN-001) and to refuse a decision that cites a version nobody registered.

## Options

1. **Two small tables, seeded by migration, read-only for the client.**
   `model_registry (id, kind ∈ {committee_model, prompt_contract}, version,
   provider, introduced_at, retired_at, notes)`; `calc_registry (id, name,
   version, rule, introduced_at)`. A guard test asserts every constant the
   code exports (`PROMPT_VERSION`, `UNIVERSE_RANK_VERSION`, …) has a row,
   so bumping a constant without a migration fails the suite. No FK from
   `decisions` yet (the provider's model id is not ours to enumerate).
2. **Option 1 plus a FK** from `decisions.prompt_version` to the registry.
   Stronger, but a provider-side model change would then block a decision
   write until a migration lands — the wrong failure mode for a single-user
   app that deploys on merge.
3. **Nothing until §36.1's model-promotion decision.** The evaluation and
   rollback halves of CONST-007 do wait on it; the registry does not.

## Recommendation

**Option 1.** Cheap, and it turns "which version" from a comment into a row
the scorecard can group by. Consequences: one migration with its schema
test; a guard test over exported version constants; `/settings` lists the
registered versions; the Committee brief cites the registered prompt
contract row.

## Decision

<!-- Amir -->
