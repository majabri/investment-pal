// Executions against an order (§12.3), and the arithmetic the roll-up cannot do.
//
// `orders.filled_quantity` and `orders.average_fill_price` are a SUMMARY of the
// fills. A summary cannot answer three questions the ledger needs:
//
//   * What did the fills cost? Fees have nowhere to live on the order.
//   * Which statement line was this? The broker's confirmation reference is
//     what makes an import idempotent and a reconciliation possible.
//   * Did the second partial ADD to the first, or replace it? A single pair of
//     columns cannot tell those apart, which is why §26.2 lists "partial fill
//     updates exactly once" as a mandatory test — it is the defect a roll-up
//     invites.
//
// Everything here is pure. The fills are the record; these functions read them.

/** Where a fill row came from. No AI value (rule 18). */
export type FillSource = "imported" | "user_entry" | "derived";

/** One execution. `quantity` is always positive; the SIDE lives on the order. */
export type Fill = {
  id: string;
  order_id: string;
  filled_at: string;
  quantity: number;
  price: number;
  /** Positive as a cost. NULL = NOT KNOWN, never zero. */
  fees: number | null;
  source: FillSource;
  /** The broker's confirmation reference, where one was supplied. */
  broker_ref: string | null;
};

/**
 * How much of an order the fills account for.
 *
 * `unknown` is not a count of zero. It is what a fill with an unusable quantity
 * produces — and a partially-known total is worse than none, because it looks
 * like a smaller position rather than an uncertain one.
 */
export type FillTotals = {
  quantity: number | null;
  /** Gross value: Σ quantity × price. NULL when any fill is unusable. */
  value: number | null;
  /**
   * Σ fees, or NULL when ANY fill's fees are unknown.
   *
   * All-or-nothing on purpose. Summing the fees that happen to be recorded and
   * presenting the result as "fees" understates the cost by exactly the ones
   * that are missing, with no sign that anything is absent.
   */
  fees: number | null;
  /** Fills counted. Distinct from quantity: two fills can total one share. */
  count: number;
};

const usable = (f: Fill): boolean =>
  Number.isFinite(f.quantity) && f.quantity > 0 && Number.isFinite(f.price) && f.price > 0;

/** What a set of fills adds up to. */
export function fillTotals(fills: readonly Fill[]): FillTotals {
  let quantity = 0;
  let value = 0;
  let fees = 0;
  let quantityKnown = true;
  let feesKnown = true;

  for (const f of fills) {
    if (!usable(f)) {
      quantityKnown = false;
      continue;
    }
    quantity += f.quantity;
    value += f.quantity * f.price;
    if (f.fees === null || !Number.isFinite(f.fees)) feesKnown = false;
    else fees += f.fees;
  }

  return {
    quantity: quantityKnown ? quantity : null,
    value: quantityKnown ? value : null,
    fees: feesKnown ? fees : null,
    count: fills.length,
  };
}

/**
 * Volume-weighted average fill price, or NULL.
 *
 * Weighted by quantity, not a mean of the prices: 100 shares at $10 and 1 share
 * at $20 average to $10.10, not $15. The unweighted version is the classic way
 * a blended cost comes out wrong in favour of the smallest fill.
 *
 * Fees are NOT folded in. An average price with costs baked into it is neither
 * a price nor a cost, and reconciling it against a broker's average — which
 * excludes fees — would show a discrepancy that is not one.
 */
export function averageFillPrice(fills: readonly Fill[]): number | null {
  const t = fillTotals(fills);
  if (t.quantity === null || t.value === null || t.quantity <= 0) return null;
  return t.value / t.quantity;
}

/**
 * Whether the fills reconcile against the order's own rolled-up quantity.
 *
 * `matched` — they agree, within the epsilon fractional shares need.
 * `over` — the fills exceed the order. A data problem, surfaced rather than
 *   clamped: clamping would hide a double-imported statement, which is the
 *   exact failure the idempotency index exists to prevent.
 * `under` — the order says more is filled than the fills account for, which is
 *   the normal state while fills are being entered.
 * `unknown` — either side cannot be stated.
 */
export type FillReconciliation = "matched" | "over" | "under" | "unknown";

/** Fractional shares are real; exact equality is the wrong test. */
export const FILL_QUANTITY_EPSILON = 1e-6;

export function reconcileFills(
  fills: readonly Fill[],
  orderFilledQuantity: number | null,
): FillReconciliation {
  const t = fillTotals(fills);
  if (t.quantity === null) return "unknown";
  if (orderFilledQuantity === null || !Number.isFinite(orderFilledQuantity)) return "unknown";
  const diff = t.quantity - orderFilledQuantity;
  if (Math.abs(diff) <= FILL_QUANTITY_EPSILON) return "matched";
  return diff > 0 ? "over" : "under";
}

/**
 * Whether a fill may be recorded, given what is already there (§19.3, §26.2).
 *
 * The mandatory test is "partial fill updates exactly once". The database's
 * partial unique index enforces it for fills that carry a broker reference;
 * this is the readable refusal, and it also covers the case the index cannot —
 * a hand-entered fill with no reference at all.
 */
export type FillRejection =
  | "duplicate_broker_ref"
  | "not_a_quantity"
  | "not_a_price"
  | "negative_fees";

export function fillRejection(
  candidate: { quantity: number | null; price: number | null; fees: number | null; broker_ref: string | null },
  existing: readonly Fill[],
): FillRejection | null {
  if (candidate.quantity === null || !Number.isFinite(candidate.quantity) || candidate.quantity <= 0) {
    return "not_a_quantity";
  }
  if (candidate.price === null || !Number.isFinite(candidate.price) || candidate.price <= 0) {
    return "not_a_price";
  }
  if (candidate.fees !== null && (!Number.isFinite(candidate.fees) || candidate.fees < 0)) {
    return "negative_fees";
  }
  const ref = candidate.broker_ref?.trim();
  if (ref) {
    // Case-insensitive: brokers are not consistent about it, and two rows
    // differing only in case are the same execution imported twice.
    const seen = existing.some((f) => f.broker_ref?.trim().toLowerCase() === ref.toLowerCase());
    if (seen) return "duplicate_broker_ref";
  }
  return null;
}

/** Whether a candidate fill may be recorded at all. */
export function canRecordFill(
  candidate: Parameters<typeof fillRejection>[0],
  existing: readonly Fill[],
): boolean {
  return fillRejection(candidate, existing) === null;
}
