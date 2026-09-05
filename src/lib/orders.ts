// The broker-neutral order model (Phase 6, rule 19).
//
// "Order id, account, instrument, side, quantity, type, limit, stop, TIF,
// status, filled quantity, average fill price, parent/child, OCO group,
// timestamps, execution source. Statuses modelled generically, not in one
// broker's terms."
//
// Why this exists before any screen needs it: `readiness.ts` hardcoded
// `openOrdersKnown: false` for every caller, because there was no data that
// could make it true. That was the honest value and it was also a permanent
// block on the position-sizing capability. This is the data that lets the
// answer be something other than "we cannot say" — and, crucially, lets it
// stay "we cannot say" for an account nobody has told the app about, rather
// than becoming "no open orders" the moment the table exists but is empty.
//
// Pure: no React, no Supabase client.
import { isDecisionGrade, freshnessOf, type Freshness } from "./freshness";

/** Generic, never one broker's vocabulary (rule 19, rule 8). */
export const ORDER_STATUSES = [
  "pending_new",
  "open",
  "partially_filled",
  "filled",
  "cancelled",
  "rejected",
  "expired",
  /**
   * A real status, not a parse failure swallowed.
   *
   * An import may carry an order whose state the adapter cannot map. Holding
   * it as unknown keeps the order visible — and keeps the readiness gate
   * honest about it — where dropping the row would quietly reduce the account's
   * committed capital to whatever happened to map.
   */
  "unknown",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_SIDES = ["buy", "sell", "sell_short", "buy_to_cover"] as const;
export type OrderSide = (typeof ORDER_SIDES)[number];

export const ORDER_TYPES = [
  "market",
  "limit",
  "stop",
  "stop_limit",
  "trailing_stop",
  "other",
] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const TIME_IN_FORCE = ["day", "gtc", "ioc", "fok", "opg", "cls", "other"] as const;
export type TimeInForce = (typeof TIME_IN_FORCE)[number];

/** imported | user_entry. There is deliberately no AI value (rule 18). */
export const EXECUTION_SOURCES = ["imported", "user_entry"] as const;
export type ExecutionSource = (typeof EXECUTION_SOURCES)[number];

export type Order = {
  id: string;
  user_id: string;
  account_id: string;
  broker_order_id: string | null;
  symbol: string;
  side: string;
  /** NULL = not known. A partially-read import must not claim a size. */
  quantity: number | null;
  order_type: string;
  limit_price: number | null;
  stop_price: number | null;
  time_in_force: string | null;
  status: string;
  /** NULL = not known, which is NOT zero. */
  filled_quantity: number | null;
  average_fill_price: number | null;
  parent_order_id: string | null;
  oco_group: string | null;
  /**
   * The tranche this order is attached to (Phase 6b). NULL = the whole
   * position. `exitScope` in `lots.ts` is where that distinction is read; it
   * is the difference between a stop covering one lot and covering the whole
   * holding, which is a money-losing error in both directions.
   */
  lot_id: string | null;
  placed_at: string | null;
  status_as_of: string | null;
  execution_source: string;
  currency: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Statuses that mean capital is currently committed.
 *
 * `unknown` counts. An order whose state could not be mapped MIGHT be working,
 * and treating it as closed is the assumption that loses money: it frees
 * capital the app cannot prove is free.
 */
const COMMITTED: ReadonlySet<string> = new Set<string>([
  "pending_new",
  "open",
  "partially_filled",
  "unknown",
]);

export function isCommitted(status: string): boolean {
  return COMMITTED.has(status);
}

/** Structural minimum, so callers need not depend on the full row. */
export type OrderLike = {
  status: string;
  side: string;
  quantity: number | null;
  filled_quantity: number | null;
  limit_price: number | null;
  order_type: string;
};

/**
 * Quantity still working on an order, or `null` when it cannot be stated.
 *
 * Not `quantity - filled`, defaulting the filled part to 0. An order whose
 * fill is unknown has an unknown remainder, and reporting the full size as
 * still working overstates the commitment exactly when the app knows least.
 */
export function remainingQuantity(o: OrderLike): number | null {
  if (!isCommitted(o.status)) return 0;
  if (o.quantity === null || !Number.isFinite(o.quantity)) return null;
  if (o.status === "partially_filled") {
    if (o.filled_quantity === null || !Number.isFinite(o.filled_quantity)) return null;
    // An over-fill is a data problem, not a negative remainder. Surfaced as
    // zero remaining rather than as a negative commitment.
    return Math.max(0, o.quantity - o.filled_quantity);
  }
  return o.quantity;
}

/**
 * Cash a working BUY would consume if it filled, or `null` when unknowable.
 *
 * Only limit and stop-limit orders have a knowable cost: a market order's cost
 * depends on where it fills, and a stop order becomes a market order. `null`
 * for those is the point — a screen that reported $0 committed for three
 * working market orders would be telling the user capital is free that is not.
 *
 * Deliberately NOT summed into equity or subtracted from cash anywhere. Rule
 * 8: an open-order commitment is informational, displayed separately, and the
 * broker's own buying-power figure already reflects it.
 */
export function committedCash(o: OrderLike): number | null {
  if (o.side !== "buy" && o.side !== "buy_to_cover") return 0;
  const remaining = remainingQuantity(o);
  if (remaining === null) return null;
  if (remaining === 0) return 0;
  if (o.order_type !== "limit" && o.order_type !== "stop_limit") return null;
  if (o.limit_price === null || !Number.isFinite(o.limit_price)) return null;
  return remaining * o.limit_price;
}

/**
 * The total cash committed to working buys, or `null` when ANY of them cannot
 * be priced.
 *
 * All-or-nothing, like `sumField` and `combinedTarget`. "The total of the
 * orders we happen to be able to price" is not the committed total, and there
 * is no way to render it that does not read as one.
 */
export function totalCommittedCash(orders: OrderLike[]): number | null {
  let total = 0;
  for (const o of orders) {
    const c = committedCash(o);
    if (c === null) return null;
    total += c;
  }
  return total;
}

/**
 * Whether the app can currently state this account's open orders.
 *
 * The question the readiness gate asks, and the reason it could only ever
 * answer `false` before this module existed. Three distinct nos:
 *
 *   * nobody has ever told the app about this account's orders;
 *   * the last telling was too long ago to decide from;
 *   * the provenance is unreadable.
 *
 * An account with `orders_as_of` set and no order rows IS known: it means the
 * source was read and reported nothing working. That is the case an empty
 * table alone can never distinguish, and the reason this takes the timestamp
 * rather than counting rows.
 */
export function openOrdersKnown(
  account: { orders_as_of: string | null; orders_source: string | null } | null,
  now = new Date(),
): boolean {
  if (account === null || account.orders_as_of === null) return false;
  const f: Freshness = freshnessOf(
    // The timestamp is the figure here — there is no amount to be fresh about,
    // and `freshnessOf` short-circuits on a missing value.
    1,
    {
      sourceType: account.orders_source === "user_entry" ? "user_entry" : "imported_snapshot",
      asOf: account.orders_as_of,
    },
    now,
  );
  return isDecisionGrade(f);
}
