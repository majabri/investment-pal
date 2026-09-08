# ADR-APP-011 — The reconciliation engine

- **Status:** Proposed
- **Date:** 2026-09-05
- **Deciders:** Amir (product owner)
- **Money-adjacent:** **Yes** — defines the thresholds at which a difference is material
- **Serves:** USER-AGNOSTIC FINANCIAL TRUTH & RECONCILIATION STANDARD, rules 5, 6, 10, 11, 12, 31

## Context

The app compared its own total against the broker's and showed a banner. The
banner had three messages for two outcomes, and ended with:

> **"Treat the broker's figure as correct."**

Rules 5 and 6 say neither value is assumed correct. A broker's figure can be
stale, can predate a transfer, and can itself be wrong. Telling the user which
number to believe is the app making a judgement it has no basis for, in the one
place whose entire job is to say the two disagree.

## Decision

### Seven states, and the order they are evaluated in

```
unsupported → missing data → staleness → tolerance bands
```

**Precedence matters more than the thresholds.** A stale figure that also fails
the tolerance check is `STALE`, not `NOT_RECONCILED`: telling someone their books
disagree by $4,000 when the real problem is that one side is three months old
sends them to fix the wrong thing.

| State | Checked? | Means |
|---|---|---|
| `RECONCILED` | yes | difference is rounding noise |
| `WARNING` | yes | a real difference, small enough to watch |
| `NOT_RECONCILED` | yes | material — something is actually wrong |
| `DATA_INCOMPLETE` | no | an input is missing → import |
| `STALE` | no | inputs too old to compare → refresh |
| `UNSUPPORTED` | no | no broker figure exists, and none ever will |
| `ERROR` | no | the comparison itself failed — a defect |

`UNSUPPORTED` is not a failure. An account with no import path can never
reconcile, and a gate that can never be satisfied is one people route around.

### Two bands, both thresholds, fired on EITHER

```ts
DEFAULT_TOLERANCE = { noiseUsd: 0.01, materialUsd: 100, materialPct: 0.0005 }
```

Rule 31 — no threshold tuned to one portfolio's size — is why there are two:

- **A percentage alone** lets $25,000 pass on a $5m account at 0.5%.
- **A dollar figure alone** flags every difference on a $500 account, or, tuned
  the other way, misses a total loss on it.

Neither threshold is derived from any portfolio. They are statements about what
counts as money and what counts as a proportion, and both hold at any scale.
Tested at $500 and at $5,000,000.

### Never adjust a calculation to force agreement

A persistent difference is a **finding to surface**, not a bug to tune away. The
panel shows both figures, the difference, the status, the source and the as-of,
expandable to the full derivation — and does **not** say which one to believe.

## Consequences

**Accepted:** the user sometimes sees "these disagree and we do not know which is
right". That is the honest state, and the previous line resolved it by inventing
an authority.

**Accepted:** `materialUsd: 100` will flag differences some users consider noise
at scale. The percentage band catches the rest; a user-configurable tolerance is
the natural extension and is not built.

## Cautionary note recorded

The first test for "proportionally tiny but large-dollar" used $5,000 on $5m —
0.1%, already over `materialPct`, so it **passed with the dollar check deleted**.
Rewritten to $300 on $5m (0.006%) with an explicit assertion that it sits below
the percentage threshold. A control that does not isolate the thing it tests
proves nothing.

## Implementation

`src/lib/reconciliation.ts`, `src/lib/reconciliationInput.ts`,
`src/components/app/ReconciliationPanel.tsx`,
`src/lib/__tests__/reconciliation.test.ts`.
