// How old a financial figure is, and whether that matters (Phase 1d, rule 14).
//
// Every money figure in the app has a provenance: who said it, how it arrived,
// and when it was true. Today only `account_balances.imported_at` records any
// of that, and nothing reads it — so a balance pasted three months ago renders
// in the same typeface as one pasted this morning, and the app cannot tell a
// live quote from a snapshot from a figure somebody typed.
//
// This module answers one question — what state is this figure in — and it is
// the only place that answers it. A second opinion elsewhere is how two screens
// start disagreeing about whether the same number is stale.

/** How a figure reached the app. */
export type SourceType =
  /** A quote provider, priced now. */
  | "live_quote"
  /** A provider that is explicitly behind real time (free tiers usually are). */
  | "delayed_quote"
  /** A broker balance block or positions file, capturing a moment. */
  | "imported_snapshot"
  /** Somebody typed it. */
  | "user_entry";

/**
 * The state a figure is in.
 *
 * Six states, not a boolean, because they call for different actions and say
 * different things:
 *
 *   * CURRENT — usable as-is.
 *   * DELAYED — usable, but the number is knowingly behind; say so beside it.
 *   * IMPORTED_SNAPSHOT — true when captured and not since. Correct for a
 *     balance; wrong to present as a live figure.
 *   * STALE — old enough that a decision made on it is a decision made on
 *     history. Fixed by importing again.
 *   * UNKNOWN — we hold a figure but not when it was true. Distinct from STALE:
 *     it may be fine, and the fix is recording provenance, not re-importing.
 *   * UNAVAILABLE — there is no figure. Rule 30's "Account equity: Unavailable".
 */
export type Freshness =
  | "CURRENT"
  | "DELAYED"
  | "IMPORTED_SNAPSHOT"
  | "STALE"
  | "UNKNOWN"
  | "UNAVAILABLE";

export type Provenance = {
  sourceType: SourceType | null;
  /** When the figure was TRUE, not when it was fetched. ISO 8601, or null. */
  asOf: string | null;
};

/**
 * How long a figure of each kind stays usable, in hours.
 *
 * Configurable, and deliberately not one global number: a quote is stale in
 * minutes, a balance in days. Rule 31 — no threshold may be tuned to one
 * portfolio, and none of these are, because none of them is about size.
 */
export type StalenessPolicy = Record<SourceType, number>;

export const DEFAULT_STALENESS: StalenessPolicy = {
  live_quote: 1,
  delayed_quote: 4,
  // A balance import is a snapshot: it does not become WRONG with age, it
  // becomes less representative. A week is when "as of last Monday" stops being
  // a reasonable basis for a position decision.
  imported_snapshot: 24 * 7,
  // A typed figure has no natural decay, but it has no reconciliation either.
  // A month is when the app should ask again rather than keep asserting it.
  user_entry: 24 * 30,
};

/**
 * The state of one figure.
 *
 * `value === null` short-circuits to UNAVAILABLE before anything else is
 * considered: there is nothing to be fresh or stale ABOUT, and reporting a
 * missing figure as "current" would be the worst of both defects.
 */
export function freshnessOf(
  value: number | null | undefined,
  p: Provenance,
  now: Date = new Date(),
  policy: StalenessPolicy = DEFAULT_STALENESS,
): Freshness {
  if (value === null || value === undefined || !Number.isFinite(value)) return "UNAVAILABLE";
  if (p.sourceType === null) return "UNKNOWN";
  if (p.asOf === null) return "UNKNOWN";

  const at = new Date(p.asOf);
  if (Number.isNaN(at.getTime())) return "UNKNOWN";

  const hours = (now.getTime() - at.getTime()) / 3_600_000;
  // A figure stamped in the future is not fresh, it is wrong. Reporting it as
  // CURRENT would make a clock error look like the best possible data.
  if (hours < 0) return "UNKNOWN";
  if (hours > policy[p.sourceType]) return "STALE";

  switch (p.sourceType) {
    case "live_quote":
      return "CURRENT";
    case "delayed_quote":
      return "DELAYED";
    case "imported_snapshot":
      return "IMPORTED_SNAPSHOT";
    case "user_entry":
      // Within its window a typed figure is what the user last confirmed, which
      // is the strongest claim available for a hand-entered number.
      return "CURRENT";
  }
}

/**
 * Whether a figure in this state may be the basis of a portfolio-dependent
 * recommendation.
 *
 * The readiness gate proper is Phase 5 (rule 17); this is the per-figure half
 * it will consult, so the definition lives with the states rather than being
 * restated there.
 */
export function isDecisionGrade(f: Freshness): boolean {
  return f === "CURRENT" || f === "DELAYED" || f === "IMPORTED_SNAPSHOT";
}

/** One short phrase for beside the figure. Never empty — an unlabelled figure
 *  is the defect this module exists to fix. */
export function freshnessLabel(f: Freshness, asOf: string | null = null): string {
  const when = asOf ? ` (as of ${asOf.slice(0, 10)})` : "";
  switch (f) {
    case "CURRENT":
      return `current${when}`;
    case "DELAYED":
      return `delayed quote${when}`;
    case "IMPORTED_SNAPSHOT":
      return `imported snapshot${when}`;
    case "STALE":
      return `stale${when}`;
    case "UNKNOWN":
      return "age not known";
    case "UNAVAILABLE":
      return "not available";
  }
}
