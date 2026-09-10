// The household roll-up, as arithmetic (audit brief G4).
//
// Extracted from a ~50-line IIFE inside `index.tsx`'s JSX. The comment it
// carried is the reason it is worth testing: this strip used to hold its OWN
// copy of `positions + cash − debt`, and with it a Phase 1a site that was
// missed — `Number(a.cash ?? 0) - Number(a.margin_used ?? 0)` turned an
// unpopulated account's UNKNOWN balance into a real zero inside the HOUSEHOLD
// total, where it is least visible.
//
// It now goes through `accountTotals`, so the coercion cannot come back. What
// this module adds is the roll-up rule on top of it, which had no test at all.
//
// THE RULE: all-or-nothing per group. A category total that silently omits one
// account is not that category's total, and a household total missing an
// account is worse — it is a smaller, plausible number with nothing marking it.
// One unknown account makes its group unknown and the household unknown.
//
// The day change is the exception, and deliberately so: it is derived from live
// quotes rather than from stored balances, so an account whose BALANCE is
// unknown still has a known day change on the positions it holds.
import { accountTotals, type BalanceLike, type PositionLike } from "./accountTotals";
import { accountCategory } from "./data/accountGroups";

/** A quote, in the shape the day change needs. */
export type QuoteLike = { price: number; prevClose: number };

/** A holding scoped to an account. */
export type HouseholdHolding = PositionLike & { account_id: string | null; symbol: string };

/** An account row: its identity, its balances, and how it is categorised. */
export type HouseholdAccount = BalanceLike & { id: string };

export type GroupTotal = {
  /** Net equity for the group. NULL = at least one account is unknown. */
  net: number | null;
  /** Day change, from live quotes. Known even where a balance is not. */
  day: number;
};

export type HouseholdRollup = {
  total: number | null;
  totalDay: number;
  /** Category → total, in no particular order; the caller orders for display. */
  groups: Map<string, GroupTotal>;
};

/** Day change for a set of holdings, from quotes that carry a previous close. */
function dayChangeOf(
  rows: readonly HouseholdHolding[],
  quotes: Record<string, QuoteLike> | undefined,
): number {
  let sum = 0;
  for (const h of rows) {
    const q = quotes?.[h.symbol];
    // No previous close means no day change for that holding — not a zero
    // contribution asserted as a fact, just nothing to add.
    if (q && q.prevClose > 0) sum += h.quantity * (q.price - q.prevClose);
  }
  return sum;
}

/**
 * Household and per-category totals.
 *
 * `priceOf` lets the caller substitute a live quote for the stored price,
 * exactly as `accountTotals` does — this module knows nothing about quotes
 * beyond the day change.
 */
export function householdRollup(
  accounts: readonly HouseholdAccount[],
  holdings: readonly HouseholdHolding[],
  quotes: Record<string, QuoteLike> | undefined,
  priceOf: (h: HouseholdHolding) => number,
): HouseholdRollup {
  const groups = new Map<string, GroupTotal>();
  let total: number | null = 0;
  let totalDay = 0;

  for (const account of accounts) {
    const rows = holdings.filter((h) => h.account_id === account.id);
    const net = accountTotals(rows, account, priceOf).totalAccountValue;
    const day = dayChangeOf(rows, quotes);

    totalDay += day;
    // Unknown propagates, and once it has propagated it stays: a later known
    // account must not restore a total that is already missing one.
    total = total === null || net === null ? null : total + net;

    const category = accountCategory(account as never);
    const g = groups.get(category) ?? { net: 0, day: 0 };
    g.net = g.net === null || net === null ? null : g.net + net;
    g.day += day;
    groups.set(category, g);
  }

  return { total, totalDay, groups };
}
