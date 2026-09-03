// Margin cost, from IPS policy (ADR-APP-007).
//
// Before this, the rate was a constant in two places — `(marginUsed * 0.11825)
// / 365` on the dashboard and "Owed to Fidelity at 11.825% APR" on MarginCard.
// They agreed by coincidence. Nothing kept them agreeing, so changing one would
// have left the app confidently displaying a rate it was not using.
//
// The rate now lives in `public.ips_lite` and there is no constant anywhere in
// this file. That is deliberate and load-bearing: Fidelity's rate is tiered by
// debit balance and floats with the base rate, so any hardcoded number is wrong
// over time — it drifts as rates move, and it is wrong the moment the balance
// crosses a tier, even if nobody changed anything.
//
// THE RULE THIS MODULE EXISTS TO ENFORCE: an unset rate suppresses the cost
// figure. It never falls back to zero, never to a previous value, never to a
// plausible default. A missing rate that silently computes as zero makes
// leverage look free, next to the very cap meant to limit leverage.

/** The margin policy fields of an `ips_lite` row. */
export type MarginPolicy = {
  /** Annual percentage rate, e.g. 11.825 — a percentage, not a fraction. */
  margin_rate_annual_pct: number | null;
  /** ISO date (YYYY-MM-DD) the rate was verified. */
  margin_rate_as_of: string | null;
  margin_rate_is_floating: boolean;
  margin_rate_stale_days: number;
};

export const MARGIN_POLICY_UNSET: MarginPolicy = {
  margin_rate_annual_pct: null,
  margin_rate_as_of: null,
  margin_rate_is_floating: true,
  margin_rate_stale_days: 30,
};

/**
 * Daily interest on a margin balance.
 *
 * Returns **null** when the rate is unset — the caller must render an explicit
 * "not set" state rather than a number. Returning 0 here would be the bug.
 */
export function dailyMarginInterest(
  marginUsed: number,
  policy: MarginPolicy,
): number | null {
  const rate = policy.margin_rate_annual_pct;
  if (rate == null || !Number.isFinite(rate)) return null;
  if (!Number.isFinite(marginUsed) || marginUsed <= 0) return 0;
  return (marginUsed * (rate / 100)) / 365;
}

/** Annual interest at the current balance. Null when the rate is unset. */
export function annualMarginInterest(
  marginUsed: number,
  policy: MarginPolicy,
): number | null {
  const daily = dailyMarginInterest(marginUsed, policy);
  return daily == null ? null : daily * 365;
}

export type RateStatus =
  | { kind: "unset" }
  | { kind: "current"; asOf: string | null; ageDays: number | null }
  | { kind: "stale"; asOf: string; ageDays: number }
  | { kind: "unverified" };

/**
 * How much the stored rate can be trusted.
 *
 * `unverified` — a rate with no as-of date. It is usable but its age is
 * unknowable, which is worth saying rather than implying it is fresh.
 */
export function rateStatus(policy: MarginPolicy, now: Date = new Date()): RateStatus {
  if (policy.margin_rate_annual_pct == null) return { kind: "unset" };
  if (!policy.margin_rate_as_of) return { kind: "unverified" };

  const asOf = new Date(`${policy.margin_rate_as_of}T00:00:00Z`);
  if (Number.isNaN(asOf.getTime())) return { kind: "unverified" };

  const ageDays = Math.floor((now.getTime() - asOf.getTime()) / 86_400_000);
  if (ageDays > policy.margin_rate_stale_days) {
    return { kind: "stale", asOf: policy.margin_rate_as_of, ageDays };
  }
  return { kind: "current", asOf: policy.margin_rate_as_of, ageDays };
}

/** Short label for a UI surface. Never invents a figure. */
export function marginRateLabel(policy: MarginPolicy): string {
  if (policy.margin_rate_annual_pct == null) return "Margin rate not set";
  const rate = `${policy.margin_rate_annual_pct}% APR`;
  const kind = policy.margin_rate_is_floating ? "floating" : "fixed";
  const status = rateStatus(policy);
  if (status.kind === "stale") return `${rate} (${kind}, ${status.ageDays}d old)`;
  if (status.kind === "unverified") return `${rate} (${kind}, date not recorded)`;
  return `${rate} (${kind})`;
}

/**
 * The line handed to the committee.
 *
 * When the rate is unset this says so and tells the model not to substitute
 * one. A model asked to reason about leverage with no rate supplies a plausible
 * number of its own, which is the unsourced assertion AIOS §27 prohibits.
 */
export function marginRatePromptLine(policy: MarginPolicy): string {
  if (policy.margin_rate_annual_pct == null) {
    return "Margin interest rate: NOT SET. Do not assume, estimate, or carry forward a margin rate. If a recommendation depends on the cost of leverage, say so explicitly and ask for the current rate instead of proceeding.";
  }
  const kind = policy.margin_rate_is_floating
    ? "floating with the broker base rate"
    : "fixed";
  const status = rateStatus(policy);
  const asOf = policy.margin_rate_as_of ? `, verified ${policy.margin_rate_as_of}` : ", verification date not recorded";
  const stale = status.kind === "stale" ? ` This value is ${status.ageDays} days old and may be out of date.` : "";
  return `Margin interest rate: ${policy.margin_rate_annual_pct}% APR (${kind}${asOf}).${stale}`;
}
