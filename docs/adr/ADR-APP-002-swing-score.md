# ADR-APP-002 — Swing Score (advisory trim signal)

- **Status:** Accepted
- **Date:** 2026-08-19
- **Deciders:** Amir (product owner — line-item sign-off), implementation agent
- **Money-adjacent:** **Yes** — trim-band sizing. Numbers signed off individually below.
- **Serves:** migration plan item 5; ADR-APP-001

## Context

Per-holding 0–100 score computed from `price_history` (PR #61) signalling how
*extended* a position is, to prompt (never execute) trim consideration. **Advisory
only:** the score annotates the holding row and feeds the committee's DECISION
HISTORY context. The committee decides; Amir executes at Fidelity. No auto-orders.

Requires ~50 daily closes per symbol (for RSI(14) + 50-day MA). With insufficient
history it displays "insufficient history", never a misleading score.

## Decision — signed-off line items

Score = A1 + A2 + A3 (0–100), then the A4 earnings modifier. Higher = more extended.

| # | Rule (approved) | Reasoning | What invalidates it |
|---|---|---|---|
| A1 | **RSI(14) → 0–45 pts.** RSI≤50→0; 50–70→0–30 linear; 70–100→30–45 linear. | RSI>70 is classic overbought; weight it but cap so momentum leaders aren't over-penalised. | Strong uptrends hold RSI>70 for weeks — RSI alone over-trims winners; hence the cap + combination with MA distance. |
| A2 | **Distance above 20-day MA → 0–30 pts.** ≤0%→0; ≥+10%→30 linear. | Short-term overextension tends to mean-revert. | Just after a breakout, >10% above the 20d is normal continuation, not a trim. |
| A3 | **Distance above 50-day MA → 0–25 pts.** ≤0%→0; ≥+20%→25 linear. | Intermediate-trend stretch. | Early in a new primary uptrend, distance above the 50d is healthy strength. |
| A4 | **Earnings within 5 trading days → do not score; show "⚠ earnings in N d" and withhold a trim suggestion.** | Earnings is bidirectional catalyst risk; a score-driven trim into earnings conflates two decisions. | If the position is an earnings play, holding through is intentional. |
| A5 | **Score 65–79 → "consider trimming 10–25%."** (floor raised from 60 to **65**) | 65 marks meaningful multi-signal extension; a partial trim locks gains while keeping exposure. | High-conviction multi-year holds, or short-term-gain tax cost, can override; a single elevated signal shouldn't trigger. |
| A6 | **Score 80–100 → "consider trimming 25–50%."** | 80+ = multiple signals stretched at once; a larger trim de-risks. | A genuine fundamental re-rating may warrant holding despite the score. |

Below 65 → no trim suggestion (score still shown).

## Consequences

- Deterministic from `price_history`; no new provider. Sparse history degrades to
  "insufficient history".
- The score never sizes or places an order — it is one input to a human/committee
  decision. `probability_impact` and the evidence contract are untouched by it.
