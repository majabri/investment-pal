// Reconciliation: the app's arithmetic against the broker's own answer
// (Phase 3, rules 5, 6, 10, 11, 31).
//
// THE RULE THAT SHAPES EVERY LINE BELOW
//
// Neither number is assumed correct, and no calculation is ever adjusted to
// force agreement. A persistent difference is a FINDING TO SURFACE, not a bug
// to tune away — and the temptation to tune is real, because a reconciled
// screen looks like a working screen. The engine therefore reports; it never
// reaches back into the arithmetic.
//
// WHAT REPLACED THE OLD COMPARISON
//
// `reconcile()` in balanceImport.ts had two outcomes: matches, or differs. That
// is not enough to act on. "Differs" covered a one-cent float artefact and a
// missing position of $40,000, and — worse — a comparison that could not be
// made at all came out as `no-pasted-total`, one case among several that all
// mean "we did not check" for different reasons and need different fixes.
import { freshnessOf, isDecisionGrade, type Provenance } from "./freshness";

/**
 * Seven states, because seven different things go wrong and they are fixed
 * differently. Ordered from "checked and fine" to "could not check".
 */
export type ReconciliationStatus =
  /** Checked; any difference is rounding noise. */
  | "RECONCILED"
  /** Checked; a real difference, but small enough to watch rather than act on. */
  | "WARNING"
  /** Checked; the difference is material. Something is actually wrong. */
  | "NOT_RECONCILED"
  /** Not checked: an input is missing. Fixed by importing, not investigating. */
  | "DATA_INCOMPLETE"
  /** Not checked: the inputs are too old to compare meaningfully. */
  | "STALE"
  /** Not checkable in principle for this account — no broker figure exists to
   *  compare against, and none ever will without an import path. */
  | "UNSUPPORTED"
  /** The comparison itself failed. A defect, not a data problem. */
  | "ERROR";

/**
 * When a difference stops being noise, and when it becomes material.
 *
 * Two bands rather than one, because rule 11 asks for exactly that: rounding
 * noise must not raise a critical error, and material differences must.
 * Anything between the two is a WARNING — worth seeing, not worth alarming.
 *
 * BOTH a dollar and a percentage threshold, and `material` fires on EITHER.
 * That is what makes it work at $500 and at $5,000,000 (rule 31):
 *
 *   * A percentage alone would let $25,000 pass on a $5m account at 0.5%.
 *   * A dollar figure alone would flag every difference on a $500 account, or
 *     — tuned the other way — miss a total loss on it.
 *
 * Neither threshold is derived from any portfolio's size, which is the actual
 * requirement: they are statements about what counts as money and what counts
 * as a proportion, and both hold at any scale.
 */
export type ReconciliationTolerance = {
  /** At or below this, a difference is float noise from summing positions. */
  noiseUsd: number;
  /** Above this many dollars, material regardless of proportion. */
  materialUsd: number;
  /** Above this fraction of the broker's figure, material regardless of size. */
  materialPct: number;
};

export const DEFAULT_TOLERANCE: ReconciliationTolerance = {
  // Summing a few hundred positions in floating point moves the cent, nothing
  // more. This is not a "close enough" allowance.
  noiseUsd: 0.01,
  // A hundred dollars nobody can explain is worth explaining, at any account
  // size. Deliberately not a percentage of anything.
  materialUsd: 100,
  // A twentieth of a percent. At $5m that is $2,500 — caught by the dollar
  // threshold long before this — and at $500 it is 25c, which is why the pair
  // is needed rather than either alone.
  materialPct: 0.0005,
};

/** Everything the engine needs, and the provenance of each part. */
export type ReconciliationInput = {
  /** The broker's own equity figure, and when it was true. */
  external: { value: number | null; provenance: Provenance };
  /** The app's own arithmetic, and the freshness of what it was computed from.
   *  Positions and quotes have their own ages; the OLDEST governs, because a
   *  total is only as current as its stalest component. */
  calculated: { value: number | null; positions: Provenance; quotes: Provenance };
  /** False when this account has no import path at all. */
  supported?: boolean;
};

export type ReconciliationResult = {
  status: ReconciliationStatus;
  externalEquity: number | null;
  calculatedEquity: number | null;
  /** calculated − external. Positive means the app thinks the account is worth
   *  more than the broker says. */
  differenceUsd: number | null;
  /** As a fraction of the broker's figure, or null when that is zero — a
   *  percentage of nothing is not 0%, it is undefined. */
  differencePct: number | null;
  /** Which inputs stopped the comparison, when one did. Named, because
   *  "could not reconcile" is not actionable and "no balance imported for this
   *  account since March" is. */
  blockedBy: string[];
};

/**
 * Compare, and say what state the comparison is in.
 *
 * Precedence is deliberate and is the order of "how much do we even know":
 * unsupported, then missing data, then staleness, and only then the bands. An
 * account whose figures are three months old is STALE whether or not the
 * numbers happen to agree — agreement between two stale figures is not
 * evidence, and reporting it as RECONCILED would be the engine vouching for
 * something it has not checked.
 */
export function reconcileAccount(
  input: ReconciliationInput,
  tolerance: ReconciliationTolerance = DEFAULT_TOLERANCE,
  now: Date = new Date(),
): ReconciliationResult {
  const base: Omit<ReconciliationResult, "status" | "blockedBy"> = {
    externalEquity: input.external.value,
    calculatedEquity: input.calculated.value,
    differenceUsd: null,
    differencePct: null,
  };

  if (input.supported === false) {
    return { ...base, status: "UNSUPPORTED", blockedBy: ["this account has no import path"] };
  }

  const blockedBy: string[] = [];
  if (input.external.value === null) blockedBy.push("no broker figure has been imported");
  if (input.calculated.value === null) {
    blockedBy.push("the app cannot compute a total — a balance is not known");
  }
  if (blockedBy.length > 0) return { ...base, status: "DATA_INCOMPLETE", blockedBy };

  const externalFreshness = freshnessOf(input.external.value, input.external.provenance, now);
  const positionsFreshness = freshnessOf(input.calculated.value, input.calculated.positions, now);
  const quotesFreshness = freshnessOf(input.calculated.value, input.calculated.quotes, now);

  const stale: string[] = [];
  if (!isDecisionGrade(externalFreshness)) stale.push(`broker figure is ${externalFreshness}`);
  if (!isDecisionGrade(positionsFreshness)) stale.push(`positions are ${positionsFreshness}`);
  if (!isDecisionGrade(quotesFreshness)) stale.push(`quotes are ${quotesFreshness}`);

  const external = input.external.value as number;
  const calculated = input.calculated.value as number;
  const differenceUsd = calculated - external;
  // A percentage of zero is undefined, not 0%. An account genuinely worth
  // nothing still reconciles by the dollar comparison below.
  const differencePct = external === 0 ? null : differenceUsd / Math.abs(external);
  const withNumbers = { ...base, differenceUsd, differencePct };

  if (stale.length > 0) return { ...withNumbers, status: "STALE", blockedBy: stale };

  const abs = Math.abs(differenceUsd);
  if (abs <= tolerance.noiseUsd) return { ...withNumbers, status: "RECONCILED", blockedBy: [] };

  const material =
    abs > tolerance.materialUsd ||
    (differencePct !== null && Math.abs(differencePct) > tolerance.materialPct);

  return {
    ...withNumbers,
    status: material ? "NOT_RECONCILED" : "WARNING",
    blockedBy: [],
  };
}

/** Whether a status means the comparison actually happened. */
export function wasChecked(status: ReconciliationStatus): boolean {
  return status === "RECONCILED" || status === "WARNING" || status === "NOT_RECONCILED";
}

/**
 * One sentence for the panel. Never empty, and never reassuring about something
 * that was not checked — "could not be checked" and "checked and fine" are the
 * two claims this whole engine exists to keep apart.
 */
export function reconciliationHeadline(r: ReconciliationResult): string {
  switch (r.status) {
    case "RECONCILED":
      return "Reconciled — the app's total matches the broker's.";
    case "WARNING":
      return "A small difference the app cannot explain.";
    case "NOT_RECONCILED":
      return "The app's total and the broker's materially disagree.";
    case "DATA_INCOMPLETE":
      return "Not checked — an input is missing.";
    case "STALE":
      return "Not checked — the figures are too old to compare.";
    case "UNSUPPORTED":
      return "Not checkable — this account has no broker figures.";
    case "ERROR":
      return "The comparison failed.";
  }
}
