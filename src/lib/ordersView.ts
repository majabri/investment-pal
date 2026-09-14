// What the orders panel says, computed away from the component.
//
// `orders.ts` and `fills.ts` answer the arithmetic — remaining quantity,
// committed cash, whether the fills reconcile. Neither has ever been called
// from a screen: `readiness.ts` reads `accounts.orders_as_of` and nothing
// reads the rows. This is the presentation layer that finally does, kept pure
// for the reason `supersessionView.ts` is: a sentence is asserted on without
// mounting a page.
//
// Nothing here is a new figure. Every number is one the libraries below
// already produce; this decides how it is said.

import { averageFillPrice, reconcileFills } from "@/lib/fills";
import type { Fill, FillReconciliation } from "@/lib/fills";
import { committedCash, isCommitted, remainingQuantity } from "@/lib/orders";
import type { OrderLike } from "@/lib/orders";

/** Status as text, never colour alone (the `DecisionCard` precedent). */
export const STATUS_LABEL: Record<string, string> = {
  pending_new: "Pending",
  open: "Open",
  partially_filled: "Partially filled",
  filled: "Filled",
  cancelled: "Cancelled",
  rejected: "Rejected",
  expired: "Expired",
  unknown: "Status unknown",
};

export const SIDE_LABEL: Record<string, string> = {
  buy: "Buy",
  sell: "Sell",
  sell_short: "Sell short",
  buy_to_cover: "Buy to cover",
};

/**
 * The database's `orders_vocabulary` CHECK guarantees membership, so the
 * fallback is for a vocabulary that grows before this map does — the raw
 * value, which is at least true, rather than a blank.
 */
export const statusLabel = (status: string): string => STATUS_LABEL[status] ?? status;
export const sideLabel = (side: string): string => SIDE_LABEL[side] ?? side;

/**
 * What the fills say about an order.
 *
 * `not_recorded` is its own state, for the reason `trancheCoverage` has one:
 * an order with no fills yet is the state every order is in until somebody
 * records one. `reconcileFills([], n)` would call that `under`, which is
 * arithmetically true and reads as a discrepancy — a warning on every order
 * on day one.
 */
export type FillSummary =
  | { state: "not_recorded" }
  | {
      state: "recorded";
      count: number;
      reconciliation: FillReconciliation;
      /** Volume-weighted, fees excluded. NULL when any fill is unusable. */
      average: number | null;
    };

export function fillSummary(
  fills: readonly Fill[],
  order: { filled_quantity: number | null },
): FillSummary {
  if (fills.length === 0) return { state: "not_recorded" };
  return {
    state: "recorded",
    count: fills.length,
    reconciliation: reconcileFills(fills, order.filled_quantity),
    average: averageFillPrice(fills),
  };
}

/** The sentence for a fill summary. Prices are left to the caller to format. */
export function fillSentence(s: FillSummary): string {
  if (s.state === "not_recorded") return "No fills recorded against this order.";
  const n = `${s.count} fill${s.count === 1 ? "" : "s"}`;
  switch (s.reconciliation) {
    case "matched":
      return `${n}, matching the order's filled quantity.`;
    case "under":
      return `${n} recorded; the order reports more filled than they account for.`;
    case "over":
      // Surfaced, never clamped: the idempotency index exists for exactly this.
      return `${n} EXCEED the order's filled quantity — check for a double import.`;
    case "unknown":
      return `${n}; cannot be reconciled because a quantity is not known.`;
  }
}

/**
 * Half a cent. Brokers round an average to the cent; the fills carry more
 * precision than that, and exact equality would flag every order.
 */
export const AVERAGE_PRICE_EPSILON = 0.005;

/**
 * Whether the average the fills produce agrees with the one the broker
 * reported. `unknown` when either side cannot be stated — which is NOT
 * agreement, and is not a discrepancy either.
 */
export type AverageAgreement = "agrees" | "differs" | "unknown";

export function averageAgreement(
  fromFills: number | null,
  broker: number | null,
): AverageAgreement {
  if (fromFills === null || broker === null) return "unknown";
  if (!Number.isFinite(fromFills) || !Number.isFinite(broker)) return "unknown";
  return Math.abs(fromFills - broker) <= AVERAGE_PRICE_EPSILON ? "agrees" : "differs";
}

/**
 * How much cash the working buys commit, and how many of them could not be
 * priced. `total` is all-or-nothing like `totalCommittedCash`, and `unpriced`
 * is the count that made it null — the actionable half.
 */
export type CommittedSummary = {
  working: number;
  total: number | null;
  unpriced: number;
};

export function committedSummary(orders: readonly OrderLike[]): CommittedSummary {
  const working = orders.filter((o) => isCommitted(o.status));
  let total = 0;
  let unpriced = 0;
  for (const o of working) {
    const c = committedCash(o);
    if (c === null) unpriced += 1;
    else total += c;
  }
  return { working: working.length, total: unpriced === 0 ? total : null, unpriced };
}

/**
 * Whether the list can be trusted, said plainly.
 *
 * `known` is `openOrdersKnown` from `orders.ts` — the timestamp, never the
 * row count. The two sentences for `!known` are the two ways an empty or
 * populated list can be misread: as "no open orders" when nobody looked, and
 * as current when the last look was too long ago.
 */
export function ordersCoverageSentence(
  known: boolean,
  rowCount: number,
  working: number,
): string {
  if (!known) {
    return rowCount === 0
      ? "Nobody has told the app about this account's orders. An empty list here is not \"no open orders\"."
      : `${rowCount} order${rowCount === 1 ? "" : "s"} on file, but the app cannot state what is working now — the source was never recorded, or is too old to decide from.`;
  }
  if (working === 0) return "No working orders. The source was read and reported nothing open.";
  return `${working} working order${working === 1 ? "" : "s"}.`;
}

/** Working orders first, then newest placed first within each group. */
export function sortOrders<T extends OrderLike & { placed_at: string | null }>(
  orders: readonly T[],
): T[] {
  return orders.slice().sort((a, b) => {
    const ca = isCommitted(a.status) ? 0 : 1;
    const cb = isCommitted(b.status) ? 0 : 1;
    if (ca !== cb) return ca - cb;
    const pa = a.placed_at ?? "";
    const pb = b.placed_at ?? "";
    return pa < pb ? 1 : pa > pb ? -1 : 0;
  });
}

/** Re-exported so the panel imports its arithmetic from one place. */
export { isCommitted, remainingQuantity, committedCash };
