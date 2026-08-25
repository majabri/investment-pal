# ADR-APP-003 — Buy-back zones (re-entry ladder after a trim/sell)

- **Status:** Accepted
- **Date:** 2026-08-19
- **Deciders:** Amir (product owner — line-item sign-off), implementation agent
- **Money-adjacent:** **Yes** — re-entry price levels. Numbers signed off below.
- **Serves:** migration plan item 6; ADR-APP-001

## Context

When a TRIM or SELL is logged, attach advisory re-entry price levels below the sale
price, shown on the holding row and in Today's Plan until hit or invalidated.
**Advisory only** — alerts/annotations, never auto-orders. Amir executes.

## Decision — signed-off line items

| # | Rule (approved) | Reasoning | What invalidates it |
|---|---|---|---|
| B1 | **Ladder at −5%, −10%, −15%** from the anchor. Attach **only to valuation/overbought-tagged trims**, never thesis-break sells. | A staggered ladder averages back in on normal pullbacks without timing one bottom. | If the trim was thesis deterioration (not valuation/overbought), re-entry is wrong — a broken thesis is not a dip to buy. |
| B2 | **Anchor = the decision's logged price** (`price_at_rec`), marked "approx". | It is the reference we have; the actual Fidelity fill may differ slightly. | If Amir enters the actual fill price, use that instead. |
| B3 | **Expire when hit, when the decision's `invalidation_conditions` trigger, or after 30 calendar days** unfilled. | Stale re-entry levels mislead; 30d bounds the "same setup" window. | A deliberate longer-horizon accumulation plan can extend the window explicitly. |

## Consequences

- Depends on a trim/sell decision carrying a tag (valuation/overbought vs thesis-break)
  and an anchor price — ties into the evidence-contract columns (ADR-IMPL / PR #63)
  and `price_at_rec` (outcome-grading work). Zones for untagged legacy decisions are
  simply not shown.
- No order is ever placed; zones are annotations for the human decision.

## Classification sign-off (money-adjacent — recorded 2026-08-20)

The one part of B1 not fixed by the ADR's numbers is *how* a trim is classified as
valuation/overbought (gets zones) vs thesis-break (never). Implemented in
`isBuybackEligible()` (`src/lib/buybackZones.ts`), shipped in PR #78.

- **Amir's explicit sign-off (retroactive to the #78 merge): option B1** — attach
  buy-back zones to `TRIM`/`REDUCE` decisions whose text shows **no thesis-break
  keywords** (thesis, deteriorate, broken, downgrade, exit, stop-loss, …);
  **full `SELL` is excluded** (likelier a thesis exit). This is the classification
  now live in production.
- **Accepted trade-off:** keyword inference will occasionally mistag; acceptable for
  now given zones are advisory (no orders).
- **Planned upgrade (UI/UX workstream): option B3** — replace keyword inference with
  an **explicit valuation/overbought tag** captured in the decision-logging flow.
  Sensible today, precise later.

## Milestone

With PR #78, the migration plan is **complete** — all seven capabilities are live on
`main`: price history, evidence contract, outcome grading, swing score, IPS-lite,
committee scorecard, and buy-back zones.
