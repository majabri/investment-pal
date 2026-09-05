// Tranches beneath a position (Phase 6, rule 19).
//
// "A position may hold several. Aggregate exposure AND individual tranche
// identity must both survive. An exit attached to a new tranche must never
// apply to the whole position."
//
// Both halves of that sentence are load-bearing and they pull against each
// other. Aggregate exposure is what every screen shows and what the position
// cap is measured against, so it must not become a per-lot figure. Tranche
// identity is what a stop attaches to, what a tax lot IS, and what tells a
// losing tranche apart from a winning position — so it must not be blended
// away.
//
// The rule this module keeps: `holdings` stays the aggregate; lots explain it.
// A position with NO recorded lots is one whose composition is NOT KNOWN, not
// one made of a single lot — and the difference decides whether a stop can be
// scoped safely.
//
// Pure: no React, no Supabase client.
import { isRealCalendarDate } from "./localDate";

export type Lot = {
  id: string;
  user_id: string;
  account_id: string;
  symbol: string;
  broker_lot_id: string | null;
  /** NULL = not known. A lot with an unknown size is still a lot. */
  quantity: number | null;
  cost_per_share: number | null;
  /** NULL = holding period NOT KNOWN, never short-term by default. */
  acquired_at: string | null;
  thesis: string | null;
  notes: string | null;
  source: string;
  as_of: string | null;
  /** Closing is a state change, not a delete (rule 29). */
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LotLike = {
  quantity: number | null;
  cost_per_share: number | null;
  acquired_at: string | null;
  closed_at: string | null;
};

export const isOpen = (l: { closed_at: string | null }) => l.closed_at === null;

/**
 * How well the recorded lots explain a position's size.
 *
 * Four answers, and the middle two are the ones a single boolean would lose:
 *
 *   * `not_recorded` — no lots at all. The composition is unknown, and a
 *     tranche-scoped stop cannot be placed safely.
 *   * `incomplete` — some lot has an unknown size, so the lots cannot be shown
 *     to account for the position even if they happen to.
 *   * `mismatched` — the lots are all known and do NOT sum to the holding.
 *     A finding to surface, never a number to adjust (rule 5's instruction not
 *     to tune a calculation into agreement, applied here).
 *   * `complete` — they sum to the holding within rounding noise.
 */
export type LotCoverage = "not_recorded" | "incomplete" | "mismatched" | "complete";

/**
 * Fractional shares mean the sum will not be exact. One ten-thousandth of a
 * share is smaller than any broker reports and larger than float error, and it
 * is a statement about share counts rather than about any portfolio's size
 * (rule 31).
 */
export const LOT_QUANTITY_EPSILON = 1e-4;

export function lotCoverage(lots: LotLike[], holdingQuantity: number | null): LotCoverage {
  const open = lots.filter(isOpen);
  if (open.length === 0) return "not_recorded";
  if (holdingQuantity === null || !Number.isFinite(holdingQuantity)) return "incomplete";
  let total = 0;
  for (const l of open) {
    if (l.quantity === null || !Number.isFinite(l.quantity)) return "incomplete";
    total += l.quantity;
  }
  return Math.abs(total - holdingQuantity) <= LOT_QUANTITY_EPSILON ? "complete" : "mismatched";
}

/**
 * Total open quantity across lots, or `null` when any is unknown.
 *
 * All-or-nothing, like `sumField`. A partial sum presented as the position's
 * size is a number wrong by exactly the amount nobody supplied.
 */
export function openQuantity(lots: LotLike[]): number | null {
  const open = lots.filter(isOpen);
  if (open.length === 0) return null;
  let total = 0;
  for (const l of open) {
    if (l.quantity === null || !Number.isFinite(l.quantity)) return null;
    total += l.quantity;
  }
  return total;
}

/**
 * Weighted average cost across open lots, or `null` when it cannot be stated.
 *
 * Weighted by quantity, not a mean of the per-share costs: a mean would let a
 * one-share lot move the basis as much as a thousand-share one. Null when any
 * lot's size OR cost is unknown, because a blended basis computed from the
 * lots that happen to be complete is not the position's basis.
 */
export function weightedCost(lots: LotLike[]): number | null {
  const open = lots.filter(isOpen);
  if (open.length === 0) return null;
  let value = 0;
  let qty = 0;
  for (const l of open) {
    if (l.quantity === null || !Number.isFinite(l.quantity)) return null;
    if (l.cost_per_share === null || !Number.isFinite(l.cost_per_share)) return null;
    value += l.quantity * l.cost_per_share;
    qty += l.quantity;
  }
  return qty > 0 ? value / qty : null;
}

/**
 * Long-term / short-term / not known, for one lot.
 *
 * `null` — not `"short"` — when the acquisition date is missing or unreadable.
 * Defaulting to short-term looks conservative and is not: it understates the
 * after-tax value of a sale the user may be told to make, and it is a claim
 * about their tax position that nobody supplied.
 *
 * The one-year boundary is the US long-term threshold. It is a statement of
 * law rather than a tuned parameter, and it holds at any portfolio size.
 */
export function holdingPeriod(
  lot: { acquired_at: string | null; closed_at?: string | null },
  at = new Date(),
): "long_term" | "short_term" | null {
  const d = lot.acquired_at;
  if (!d || !isRealCalendarDate(d)) return null;
  const acquired = new Date(`${d}T12:00:00`);
  const asOf = lot.closed_at ? new Date(lot.closed_at) : at;
  if (Number.isNaN(asOf.getTime())) return null;
  // A future acquisition date is a data error, not a zero-day hold.
  if (asOf.getTime() < acquired.getTime()) return null;
  const oneYearOn = new Date(acquired);
  oneYearOn.setFullYear(oneYearOn.getFullYear() + 1);
  // Strictly more than one year, which is the US rule: a sale on the
  // anniversary is short-term.
  return asOf.getTime() > oneYearOn.getTime() ? "long_term" : "short_term";
}

/**
 * What an exit order actually covers.
 *
 * The rule in one function. An order carrying a `lot_id` covers THAT lot and
 * nothing else; an order without one covers the position. Getting this
 * backwards is a money-losing error in both directions — a stop read as
 * covering the whole holding leaves far too much size apparently protected,
 * and a whole-position stop read as covering one tranche leaves the rest
 * apparently unprotected.
 *
 * Returns `null` when the scope cannot be determined: an order naming a lot
 * that is not in the list. That is a dangling reference, and guessing either
 * way would be worse than saying so.
 */
export function exitScope(
  order: { lot_id: string | null },
  lots: { id: string }[],
): { kind: "position" } | { kind: "lot"; lotId: string } | null {
  if (order.lot_id === null) return { kind: "position" };
  return lots.some((l) => l.id === order.lot_id) ? { kind: "lot", lotId: order.lot_id } : null;
}

/**
 * Quantity of a position left with no exit attached, or `null` when unknowable.
 *
 * The question a user actually has: how much of this is unprotected? Null
 * rather than a number whenever the lots do not fully account for the
 * position, because "3 shares unprotected" computed from a partial lot list is
 * a reassurance the data does not support.
 */
export function unprotectedQuantity(
  lots: (LotLike & { id: string })[],
  exits: { lot_id: string | null; quantity: number | null }[],
  holdingQuantity: number | null,
): number | null {
  const coverage = lotCoverage(lots, holdingQuantity);
  if (coverage !== "complete") return null;

  // A position-wide exit covers everything, whatever its size — sizing it is
  // the broker's business, and treating a partial position exit as covering
  // only part of the holding would need a lot allocation nobody has stated.
  if (exits.some((e) => e.lot_id === null)) return 0;

  let unprotected = 0;
  for (const lot of lots.filter(isOpen)) {
    const covered = exits.some((e) => e.lot_id === lot.id);
    if (covered) continue;
    if (lot.quantity === null) return null;
    unprotected += lot.quantity;
  }
  return unprotected;
}
