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
