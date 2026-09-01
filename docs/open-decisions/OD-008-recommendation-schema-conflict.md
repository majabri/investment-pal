# OD-008 — Two conflicting `recommendation.schema.json` files

- **Status:** Open
- **Raised:** 2026-08-30
- **Area:** data integrity / scope
- **Blocks:** PR-UI-3 (decision card) — handoff item 4

## Context

The 2026-08-28 handoff instructs: *"Build against this schema, not an invented
field list,"* naming
`Invest IOS/Investment_OS_Master_Repository_v1_0/24 Schemas/recommendation.schema.json`.

There are **two** files named `recommendation.schema.json` in Drive, both titled
`InvestmentRecommendation`, both created 2026-08-14T03:31:14Z, and **both inside
the same certified master repository**:

| # | Path | Required fields |
|---|---|---|
| **A** | `Investment_OS_Master_Repository_v1_0/08 APIs/contracts/` | 14 |
| **B** | `Investment_OS_Master_Repository_v1_0/24 Schemas/` | 10 |

They disagree materially — not cosmetically:

| Concern | A (`08 APIs/contracts`) | B (`24 Schemas`) |
|---|---|---|
| Evidence field | `supporting_evidence`: array of **objects** `{source_id, claim}` | `evidence`: array of **plain strings** |
| Risks field | `key_risks` | `risks` |
| Objective link | *(absent)* | `objective_id` (required) |
| Action | **enum** — BUY, SELL, HOLD, REDUCE, ADD, REBALANCE, ROTATE, WAIT, ESCALATE | free `string` |
| Provenance | requires `user_id`, `ips_version`, `model_version`, `prompt_version`, `created_at` | *(none)* |

This cannot be decided in implementation, per the governing brief Part 0.1:
*"If two specifications conflict materially, stop that path and write an
OPEN-DECISION. Never choose silently."*

### Why it matters more than a naming difference

**The evidence shape is the whole point of an evidence contract.** Under A, each
piece of evidence carries its `source_id`, so the card can show a claim *next to
where it came from*. Under B, evidence is bare strings and provenance is gone.
AIOS §27 prohibits inventing *"sourced evidence"* — a UI that renders unattributed
claims as evidence is closer to that failure than one that shows the source.

**The shipped code was built against A, not B.** `supabase/migrations/20260819120000_decisions_evidence_contract.sql`:

- names the column **`key_risks`** — A's name, not B's `risks`
- comments the evidence column `-- supporting evidence: [{ source, claim, ... }]`
  — A's object shape, not B's `string[]`

`public.decisions` also already carries `user_id` and `created_at` (A requires
both; B requires neither). So whoever wrote PR #63 was reading A.

The handoff's divergence table treats `risks` → `key_risks` as a codebase
deviation to "map at the boundary and note in an ADR." Under A there is no
deviation at all — the column already matches the contract. That table is
evidence the handoff was written against B without B being reconciled to the
code.

### What each choice costs

- **Choosing B** means rendering evidence as unattributed strings, and adding an
  `objective_id` column that has no source today (the handoff itself says *"Flag
  to Amir — do not invent one"*).
- **Choosing A** means the card can show sourced evidence immediately, and the
  only genuinely missing fields are `ips_version`, `model_version` and
  `prompt_version` — model/prompt provenance for a recommendation, which is
  arguably more valuable than `objective_id` and is a known Investment OS
  requirement.

## Options

1. **A (`08 APIs/contracts`) is canonical.** The card renders
   `{source_id, claim}` evidence with attribution; `key_risks` needs no mapping;
   `action` is validated against the enum. Cost: `ips_version`,
   `model_version`, `prompt_version` are absent from `decisions` and need a
   migration (or are recorded as a known gap). Requires correcting the handoff's
   divergence table.
2. **B (`24 Schemas`) is canonical.** Matches the handoff verbatim. Cost:
   evidence loses source attribution in the UI; `key_risks` → `risks` mapping at
   the boundary; `objective_id` has no source and stays a flagged gap; the
   shipped migration is retroactively a deviation from the contract.
3. **A is canonical for implementation, B is superseded.** Same as 1, plus the
   duplicate at `24 Schemas/` is marked superseded in Drive so a future session
   cannot pick the wrong one. Only one certified contract survives.

## Recommendation

**Option 3.** A is what the database was actually built against, and it is the
only version that preserves source attribution on evidence — the property the
evidence contract exists to guarantee. Leaving both files in the certified
repository is the real defect: two files, same name, same title, same timestamp,
different contracts, and nothing marking which governs. Whichever wins, the loser
should stop being discoverable as canonical.

This is a specification question, not a money question, but it determines what a
governed recommendation is allowed to claim — so it stops for Amir rather than
being resolved in code.

## Decision

<!-- Filled in when resolved: what, by whom, when; link to the ADR/PR. -->
