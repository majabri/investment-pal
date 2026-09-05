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
export function dailyMarginInterest(marginUsed: number, policy: MarginPolicy): number | null {
  const rate = policy.margin_rate_annual_pct;
  if (rate == null || !Number.isFinite(rate)) return null;
  if (!Number.isFinite(marginUsed) || marginUsed <= 0) return 0;
  return (marginUsed * (rate / 100)) / 365;
}

/** Annual interest at the current balance. Null when the rate is unset. */
export function annualMarginInterest(marginUsed: number, policy: MarginPolicy): number | null {
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
  const kind = policy.margin_rate_is_floating ? "floating with the broker base rate" : "fixed";
  const status = rateStatus(policy);
  // Claim a verification date ONLY when the date actually parsed. A malformed
  // value used to be echoed as "verified not-a-date", which is worse than
  // saying nothing: it hands the committee a provenance claim the data does
  // not support, which is precisely what AIOS §27 forbids.
  const asOf =
    status.kind === "unverified"
      ? ", verification date not recorded"
      : `, verified ${policy.margin_rate_as_of}`;
  const stale =
    status.kind === "stale"
      ? ` This value is ${status.ageDays} days old and may be out of date.`
      : "";
  return `Margin interest rate: ${policy.margin_rate_annual_pct}% APR (${kind}${asOf}).${stale}`;
}

/**
 * What to show for margin interest, and where the figure came from.
 *
 * Stage 3 delta of the 2026-09-03 brief. The app computed a daily estimate from
 * the IPS rate; the broker's balance import carries the interest it has
 * ACTUALLY accrued this month. When both exist the observed figure wins — an
 * estimate shown next to an available actual is a worse number presented with
 * equal authority.
 *
 * The two are never blended, never reconciled into one figure, and never shown
 * without saying which is which. An estimate labelled as an actual is the
 * failure this type exists to make unrepresentable.
 */
export type InterestFigure =
  /** The broker's own accrued-this-month figure. */
  | { kind: "actual"; accruedMtd: number; importedAt: string | null }
  /** Computed from the IPS rate. Always presented as an estimate. */
  | { kind: "estimate"; daily: number; annual: number }
  /**
   * Nothing honest to show. The reason matters: "no balance imported" and
   * "the import did not carry an accrued figure" are different facts, and
   * stating the wrong one is itself a claim the data does not support.
   */
  | {
      kind: "unavailable";
      reason: "no-import" | "import-omitted-accrued" | "margin-loan-unknown";
    };

export function marginInterestFigure(args: {
  /** From the latest balance import. `null` = no import, or the paste omitted it. */
  accruedMtd: number | null;
  /** When that import was taken, for the provenance label. */
  importedAt?: string | null;
  /**
   * Whether a balance import exists at all.
   *
   * Distinct from `accruedMtd != null`: an import can exist and simply not have
   * carried the accrued line. Without this the "nothing to show" message would
   * claim no balance had ever been imported, which may be false.
   */
  hasImport?: boolean;
  /**
   * The margin debit, or NULL when the account does not know it (Phase 1a).
   *
   * NULL is not 0. Treating it as 0 returns a confident "$0.00/day" estimate
   * for an account that may be carrying a substantial loan — a cost of
   * borrowing stated as nil, which is the direction that flatters a decision.
   */
  marginUsed: number | null;
  policy: MarginPolicy;
}): InterestFigure {
  // Observed beats computed, unconditionally — including when the observation
  // is zero. "Fidelity has charged nothing this month" is a fact; replacing it
  // with an estimate of what it might charge would be inventing a broker state.
  if (args.accruedMtd != null && Number.isFinite(args.accruedMtd)) {
    return { kind: "actual", accruedMtd: args.accruedMtd, importedAt: args.importedAt ?? null };
  }
  // No observed figure, and no loan size to estimate from. Reported before the
  // rate is consulted: an unset rate is a different, fixable problem, and
  // naming that one would send the user to Settings to fix something that would
  // not help.
  if (args.marginUsed === null) {
    return { kind: "unavailable", reason: "margin-loan-unknown" };
  }
  const daily = dailyMarginInterest(args.marginUsed, args.policy);
  if (daily == null) {
    return {
      kind: "unavailable",
      reason: args.hasImport ? "import-omitted-accrued" : "no-import",
    };
  }
  return { kind: "estimate", daily, annual: daily * 365 };
}

/**
 * Whether a figure is the broker's or the app's own arithmetic.
 *
 * Callers render this beside the number. Nothing else in the app is allowed to
 * decide how to describe the provenance, because two screens describing it
 * differently is how an estimate starts reading as a fact.
 */
export function interestProvenance(figure: InterestFigure): string {
  switch (figure.kind) {
    case "actual":
      return figure.importedAt
        ? `accrued this month, per Fidelity (imported ${figure.importedAt.slice(0, 10)})`
        : "accrued this month, per Fidelity";
    case "estimate":
      return "estimated from your IPS margin rate — not the broker's figure";
    case "unavailable":
      switch (figure.reason) {
        case "margin-loan-unknown":
          return "this account's margin loan is not known, so no interest figure can be given";
        case "import-omitted-accrued":
          return "the last balance import did not include accrued interest, and no margin rate is set";
        case "no-import":
          return "no balance imported and no margin rate set";
      }
  }
}

/**
 * The same provenance, short enough for a one-line strip.
 *
 * A second wording rather than a second source: both live here, so a screen
 * that needs a compact label still cannot invent its own. Hardcoding
 * "(estimate)" at a call site is how the long and short forms drift until one
 * screen stops saying the figure is an estimate at all.
 */
export function interestProvenanceShort(figure: InterestFigure): string {
  switch (figure.kind) {
    case "actual":
      return "per Fidelity";
    case "estimate":
      return "estimate";
    case "unavailable":
      switch (figure.reason) {
        case "margin-loan-unknown":
          return "loan not known";
        case "import-omitted-accrued":
          return "not in last import";
        case "no-import":
          return "rate not set";
      }
  }
}
