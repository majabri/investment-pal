# ADR-APP-008 — Canonical recommendation contract and its divergences

- **Status:** Accepted
- **Date:** 2026-09-03
- **Deciders:** Amir Jabri (schema choice), Claude Code (mapping)
- **Money-adjacent:** No — display and storage of an existing governed record. No margin math, position sizing, tax lots or cash/order math. Adds nullable columns only.

## Context

Two files named `recommendation.schema.json`, both titled `InvestmentRecommendation`,
both created 2026-08-14, both inside `Investment_OS_Master_Repository_v1_0`, specify
materially different contracts:

| | Path | Required | Evidence | Risks | Objective link |
|---|---|---|---|---|---|
| **A** | `08 APIs/contracts/` | 14 | `supporting_evidence: [{source_id, claim}]` | `key_risks` | — |
| **B** | `24 Schemas/` | 10 | `evidence: string[]` | `risks` | `objective_id` |

Neither is in the repo. Successive handoffs named different ones as canonical, which
is what OD-008 was filed to stop.

## Decision

**A is canonical**, plus **`objective_id`** carried over from B.

Amir decided this on 2026-09-03. The supporting evidence, recorded so a future reader
can check the reasoning rather than take it on trust:

- `public.decisions` already has a column named **`key_risks`** — A's field name, not
  B's `risks`. Whoever wrote the PR #63 migration was reading A.
- That migration comments the evidence column `[{ source, claim, ... }]` — A's object
  shape, not B's `string[]`.
- `decisions` already carries `user_id` and `created_at`, both required by A and
  neither by B.
- A preserves **source attribution on every claim**. B's bare strings discard it, and
  a UI rendering unattributed strings as "evidence" is the failure AIOS §27 names.

`objective_id` is added because it is the one thing B expressed that A does not: the
link from a decision to the IPS objective it serves. It has no source today and is
**not backfilled** — it reads as not captured until an extractor writes it.

## Divergences, recorded rather than smoothed over

Two contract fields keep their existing column names:

| Contract field | Column | Why not renamed |
|---|---|---|
| `recommendation_id` | `decisions.id` | The primary key, referenced by `journal`, the buy-back ladder query and the outcome-grading migration. Renaming a live PK to satisfy a naming preference is risk with no benefit. |
| `supporting_evidence` | `decisions.evidence` | Written by the extractor and read by three screens. The mapping costs one line in `decisionEvidence.ts`; the rename costs a migration plus every reader. |

`CONTRACT_COLUMN_MAP` in `src/lib/decisionEvidence.ts` is the single place these live,
and `decisionContract.test.ts` fails if a third divergence appears without an ADR
entry.

### The `action` enum is enforced in the UI, not the database

The contract defines nine actions: BUY, SELL, HOLD, REDUCE, ADD, REBALANCE, ROTATE,
WAIT, ESCALATE. Rows already in the table use values outside that set — the PR #63
migration's own comment lists `TRIM` and `MARGIN`.

A CHECK constraint would therefore either fail to apply or require rewriting
historical decisions. Instead the card **shows an off-contract value exactly as
stored and marks it as off-contract**. It is never silently mapped onto a contract
action: turning a stored `TRIM` into `REDUCE` would put a word on a governed decision
that the committee did not use.

## Consequences

- `decisions` gains four nullable columns: `ips_version`, `model_version`,
  `prompt_version`, `objective_id`. No defaults, no backfill.
- Every pre-existing row reads "Not captured" for provenance, which is accurate —
  nobody recorded which model or prompt produced them.
- A new `/decisions` route renders the contract. Today's Plan on the dashboard is
  unchanged by this ADR.
- **The extractor does not yet write the four new columns.** Until it does, provenance
  stays empty on new rows as well as old ones. That is a visible gap by design rather
  than a hidden one, and it is the obvious next piece of work.
- B should be marked superseded in Drive. Claude Code has no write access to the
  certified repository, so that remains Amir's action; until then both files are still
  discoverable, which is the defect OD-008 identified.

## Amendment 1 (2026-09-18) — the canonical action set

The AIOS blueprint (DEC-001) names seven actions: **BUY, SELL, TRIM, CANCEL,
REPLACE, HOLD, WAIT**. The contract this ADR adopted named nine, spelling TRIM
as REDUCE, lacking CANCEL and REPLACE — the two verbs the manual-execution
lifecycle needs for a working order — and adding ADD, REBALANCE, ROTATE and
ESCALATE. On 2026-09-18 Amir chose the blueprint's seven.

Consequences, to land in a code PR citing this amendment:

- `RECOMMENDATION_ACTIONS` becomes the seven. The Committee prompt and the
  contract parser emit and accept only these.
- **Stored rows are never rewritten.** The rule above stands: an off-contract
  value already in `decisions.action` (REDUCE, ADD, ROTATE, …) is shown
  exactly as stored and marked off-contract. It is not mapped to TRIM or to
  anything else; the committee did not use that word.
- `buybackZones.ts` and `outcomeGrade.ts`, which read REDUCE today, read TRIM
  going forward and keep reading REDUCE on historical rows, explicitly, so a
  past trim still produces its zones and its grade.
- The Committee's readiness contract treats CANCEL and REPLACE as actionable
  verbs that must name the order they act on once `orders.decision_id` is
  written from the disposition flow (UX-001, still open).

