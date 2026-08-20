# ADR-APP-004 — IPS-lite (single-user policy record)

- **Status:** Accepted
- **Date:** 2026-08-19
- **Deciders:** Amir (product owner — line-item sign-off), implementation agent
- **Money-adjacent:** **Yes** — position cap + margin cap. Numbers signed off below.
- **Serves:** migration plan item 7; ADR-APP-001; the spec's IPS concept at single-user scale

## Context

One editable config record encoding the objective + constraints, injected into every
committee prompt and referenced by the Constitution Check strip. This is the
Investment OS IPS concept, at single-user scale.

## Decision — signed-off line items

| # | Rule (approved) | Reasoning | What invalidates it |
|---|---|---|---|
| C1 | **Objective: grow Amir-TOD to $150,000 by 2027-03-31** (from ~$50K). Prompt injection includes the sentence: *"The objective never justifies overriding risk limits or the evidence contract."* | The stated goal (already the app's goal); the guard sentence stops the objective being used to rationalise breaking limits. | Amir changes target/date in Settings. |
| C2 | **Max single-position weight 30% gross, SOFT enforcement** — the Constitution Check strip flags a breach; it does not block. | Concentration guardrail; soft because a high-conviction thesis may intentionally exceed it. | Amir sets it hard, or whitelists a specific core holding above the cap. |
| C3 | **Margin utilization cap 25%** of account value, with a cost-awareness note when margin is used. | Bounds leverage ("used intelligently") while keeping a buffer from a Fidelity maintenance call; conservative on a $50K account pursuing an aggressive target. **Explicitly signed off by Amir.** | Amir's risk appetite / broker maintenance terms change; re-set in Settings. |
| C4 | **Risk tolerance: above-average** (maps to existing `risk_preference`). | Matches the stated profile (comfortable with above-average risk, expects evidence-based recs). | Amir re-sets it. |

## Consequences

- IPS-lite values are injected into the v6 data block and shown in the Constitution
  Check strip. C2/C3 breaches are surfaced (soft) — they inform, they do not place or
  block orders here.
- Hard controls, if any are later set hard, gate recommendations deterministically
  (never overridable by the committee) — consistent with the constitutions.
