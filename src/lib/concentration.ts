// Concentration denominators, named and labelled.
//
// P0-05 / RISK-001. Four screens divided a position's value by four different
// things and all four printed "%":
//
//   * `portfolio.tsx` holdings table   — value ÷ total account value (net equity)
//   * `portfolio.tsx` sector bars      — value ÷ positions value (invested)
//   * `index.tsx` constitution check   — value ÷ total account value (net equity)
//   * `prompts.ts` committee data      — value ÷ portfolioValue (net equity)
//
// and `ADR-APP-004` C2 states the position cap as a fraction of GROSS. A 30%
// cap therefore means three different position sizes depending on which screen
// you read it on, and nothing on any of those screens says which. The margin
// meter has the same split: `accountTotals.marginUtilisation` is debit ÷ gross,
// while the cap actually enforced in `index.tsx` is debit ÷ net equity.
//
// This module does not resolve that conflict — resolving it is money-adjacent
// (OD-001) and belongs to the owner, so it is filed as OD-003. What this module
// does is make every ratio state its denominator, so a percentage on screen can
// no longer be read as the wrong one.
import { fmtPct } from "@/lib/finance";
import type { AccountTotals } from "@/lib/accountTotals";

/** The three things a position can be a fraction of. There is no fourth. */
export type DenominatorKey = "netEquity" | "grossAssets" | "investedAssets";

export const DENOMINATOR_KEYS: readonly DenominatorKey[] = [
  "netEquity",
  "grossAssets",
  "investedAssets",
];

/** What a percentage says it is a fraction of, in running text. */
export const DENOMINATOR_LABEL: Record<DenominatorKey, string> = {
  netEquity: "net equity",
  grossAssets: "gross assets",
  investedAssets: "invested assets",
};

/** The same, as a column heading or a form label. */
export const DENOMINATOR_HEADING: Record<DenominatorKey, string> = {
  netEquity: "% of net equity",
  grossAssets: "% of gross assets",
  investedAssets: "% of invested",
};

/** The arithmetic, spelled out, for a tooltip or a legend. */
export const DENOMINATOR_DEFINITION: Record<DenominatorKey, string> = {
  netEquity: "Cash + positions − margin debit. The broker's total account value.",
  grossAssets: "Cash + positions, before the margin debit is subtracted.",
  investedAssets: "Positions at market. Cash is excluded.",
};

/** All three denominators for one scope, with UNKNOWN preserved as null. */
export type Denominators = Record<DenominatorKey, number | null>;

/**
 * Why a denominator cannot be divided by. Three distinct answers, because
 * "we were never told the cash balance" and "this account holds nothing" are
 * not the same fact and must not print the same sentence (ADR-APP-012).
 */
export type DenominatorState = "known" | "unknown" | "zero";

/**
 * The three denominators, from the one totals arithmetic.
 *
 * `positionsValue` is a `number` rather than `number | null` in `AccountTotals`
 * — an empty position list is a known fact, not a missing one — so invested
 * assets is never UNKNOWN here. It can still be zero, which is a different
 * answer and gets a different state below.
 */
export function denominators(totals: AccountTotals): Denominators {
  return {
    netEquity: totals.totalAccountValue,
    grossAssets: totals.grossValue,
    investedAssets: totals.positionsValue,
  };
}

/** Whether `key` can be divided by, and if not, why not. */
export function denominatorState(d: Denominators, key: DenominatorKey): DenominatorState {
  const v = d[key];
  if (v === null || !Number.isFinite(v)) return "unknown";
  return v > 0 ? "known" : "zero";
}

/**
 * A position's weight against one denominator.
 *
 * `null` for both a zero and an unknown denominator. Zero is deliberately not
 * 0% and not Infinity: a position that is 100% of nothing is undefined, and
 * rendering it as a number invites someone to compare it to a cap.
 */
export function weightOf(
  positionValue: number,
  d: Denominators,
  key: DenominatorKey,
): number | null {
  const denom = d[key];
  if (denom === null || !Number.isFinite(denom) || denom <= 0) return null;
  if (!Number.isFinite(positionValue)) return null;
  return positionValue / denom;
}

/** All three weights at once, for a panel that shows the spread. */
export function weights(
  positionValue: number,
  d: Denominators,
): Record<DenominatorKey, number | null> {
  return {
    netEquity: weightOf(positionValue, d, "netEquity"),
    grossAssets: weightOf(positionValue, d, "grossAssets"),
    investedAssets: weightOf(positionValue, d, "investedAssets"),
  };
}

/** The unknown state for a percentage. Never "0.0%". */
export const UNKNOWN_PCT = "—";

/**
 * A percentage that says what it is a percentage OF.
 *
 * `unknown` exists because the em-dash is right on a dense screen and wrong in
 * a prompt: a model reading "— of net equity" has to guess, where "NOT KNOWN of
 * net equity" cannot be misread. Same absence, two audiences.
 */
export function labelledPct(
  pct: number | null | undefined,
  key: DenominatorKey,
  { decimals, unknown = UNKNOWN_PCT }: { decimals?: number; unknown?: string } = {},
): string {
  const n =
    pct === null || pct === undefined || !Number.isFinite(pct) ? unknown : fmtPct(pct, decimals);
  return `${n} of ${DENOMINATOR_LABEL[key]}`;
}

/**
 * The denominator the IPS-lite position and margin caps are enforced against.
 *
 * This constant does not decide anything — it RECORDS what `main` already
 * does, so the decision has one place to be made rather than four. `index.tsx`
 * divided by the total account value before this module existed and divides by
 * it after; the value here was read off that code, not chosen.
 *
 * It conflicts with ADR-APP-004 C2, which states the cap against GROSS. That
 * conflict is money-adjacent (OD-001), is filed as OD-003, and is the owner's
 * to settle. Until it is, the honest thing is for the breach line to say which
 * denominator produced its number — which is what `labelledPct` above is for.
 */
export const POLICY_DENOMINATOR: DenominatorKey = "netEquity";

/**
 * The denominator the IPS-lite MARGIN cap is enforced against.
 *
 * Separate from `POLICY_DENOMINATOR` on purpose. Margin utilisation is not a
 * position weight and inherited the position cap's denominator only because
 * both were written inline in the same block. Giving it its own name means the
 * two can be decided independently — and `accountTotals.marginUtilisation`,
 * which is debit ÷ gross, is a third answer that this makes visible rather
 * than reconciling on its own authority.
 */
export const MARGIN_CAP_DENOMINATOR: DenominatorKey = "netEquity";

/**
 * Margin utilisation, with its denominator named rather than assumed.
 *
 * `accountTotals.marginUtilisation` is debit ÷ gross. The cap enforced on the
 * dashboard is debit ÷ net equity. Both are defensible definitions and they
 * are not the same number; what was not defensible was printing either as
 * "Margin util 18.4%" with no denominator attached.
 */
export function marginUtilisationOf(
  marginDebit: number | null,
  d: Denominators,
  key: DenominatorKey,
): number | null {
  if (marginDebit === null || !Number.isFinite(marginDebit)) return null;
  return weightOf(marginDebit, d, key);
}
