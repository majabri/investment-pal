/**
 * The margin rate, as a value the app either has or admits it does not have.
 *
 * Before this module the rate was a constant copy-pasted into ten places across
 * three files (OD-009). Seven said 11.825%, two said 12.075%, and the tenth —
 * `(marginUsed * 0.11825) / 365` on the dashboard — turned the guess into a
 * dollar figure. Amir confirmed on 2026-09-03 that the rate has changed since
 * and did not supply the replacement, so every one of those constants is known
 * to be wrong and none may be shown or sent to the committee.
 *
 * This module deliberately does NOT compute margin cost. Recording the rate,
 * choosing its storage (`ips_lite` is recommended — `ips.schema.json` defines
 * `margin_policy` as a first-class IPS property) and deciding staleness
 * behaviour are ADR-APP-007 / Stage 5, which is blocked on Amir's line-item
 * sign-off. All this file does is make the absence explicit and give that
 * decision exactly one place to land.
 *
 * Fidelity's rate is tiered by debit balance and floats with the base rate, so
 * `annualPct` alone is not enough to be right over time — whoever fills this in
 * should expect to revisit `MarginRate` rather than just edit a number.
 */

export type MarginRate =
  | {
      readonly status: "recorded";
      /** Annual percentage rate, as a percentage (e.g. 11.825), not a fraction. */
      readonly annualPct: number;
      /** ISO date the rate was verified against the broker. */
      readonly asOf: string;
    }
  | { readonly status: "not-recorded" };

/**
 * The single source of truth. Replace with
 * `{ status: "recorded", annualPct: <rate>, asOf: "<YYYY-MM-DD>" }`
 * only under ADR-APP-007, with Amir's signed-off value — never with a rate
 * inferred from a prompt, a screenshot, or this file's history.
 */
export const MARGIN_RATE: MarginRate = { status: "not-recorded" };

/** Short label for a UI surface. Never invents a figure. */
export function marginRateLabel(rate: MarginRate = MARGIN_RATE): string {
  return rate.status === "recorded"
    ? `${rate.annualPct}% APR (verified ${rate.asOf})`
    : "rate not recorded";
}

/**
 * The line handed to the committee. When the rate is unknown this says so and
 * tells the model not to substitute one — an LLM asked to reason about leverage
 * with no rate will otherwise supply a plausible number of its own, which is
 * exactly the unsourced assertion AIOS §27 prohibits.
 */
export function marginRatePromptLine(rate: MarginRate = MARGIN_RATE): string {
  return rate.status === "recorded"
    ? `Margin interest rate: ${rate.annualPct}% APR (Fidelity, verified ${rate.asOf}).`
    : "Margin interest rate: NOT RECORDED. The previously stated rate is known to be out of date and has been removed. Do not assume, estimate, or carry forward a margin rate. If a recommendation depends on the cost of leverage, say so explicitly and ask for the current rate instead of proceeding.";
}
