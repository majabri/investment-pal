// Phase 6, rule 19: lots and tranches.
//
// "A position may hold several. Aggregate exposure AND individual tranche
// identity must both survive. An exit attached to a new tranche must never
// apply to the whole position."
//
// The last clause is a money-losing failure in both directions. A stop entered
// against one lot but read as covering the whole holding leaves far too much
// size apparently protected; a whole-position stop read as covering one
// tranche leaves the rest apparently unprotected. `holdings` cannot express
// the difference — one row per symbol, one blended cost basis.
import { describe, expect, test } from "bun:test";
import {
  LOT_QUANTITY_EPSILON,
  exitScope,
  holdingPeriod,
  lotCoverage,
  openQuantity,
  unprotectedQuantity,
  weightedCost,
} from "../lots";

const AT = new Date("2026-09-05T12:00:00Z");

const lot = (over: Record<string, unknown> = {}) => ({
  id: "l1",
  quantity: 10,
  cost_per_share: 100,
  acquired_at: "2025-01-15",
  closed_at: null,
  ...over,
});

describe("lotCoverage", () => {
  test("no lots is NOT_RECORDED, not zero coverage", () => {
    // The composition is unknown, and a tranche-scoped stop cannot be placed
    // safely against it. A position with no lots is not a position of one lot.
    expect(lotCoverage([], 10)).toBe("not_recorded");
  });

  test("lots that sum to the holding are complete", () => {
    expect(lotCoverage([lot(), lot({ id: "l2", quantity: 5 })], 15)).toBe("complete");
  });

  test("an unknown lot size is incomplete, never assumed", () => {
    expect(lotCoverage([lot(), lot({ id: "l2", quantity: null })], 15)).toBe("incomplete");
  });

  test("an unknown holding size is incomplete", () => {
    expect(lotCoverage([lot()], null)).toBe("incomplete");
  });

  test("lots that do not sum to the holding are MISMATCHED, not adjusted", () => {
    // Rule 5's instruction not to tune a calculation into agreement, applied
    // to composition: a difference is a finding to surface.
    expect(lotCoverage([lot()], 15)).toBe("mismatched");
  });

  test("closed lots do not count towards the position", () => {
    expect(lotCoverage([lot(), lot({ id: "l2", closed_at: "2026-08-01T00:00:00Z" })], 10)).toBe(
      "complete",
    );
  });

  test("fractional-share rounding is not a mismatch", () => {
    // Brokers report fractional shares; a sum that differs by less than a
    // ten-thousandth of a share is arithmetic, not a discrepancy.
    expect(lotCoverage([lot({ quantity: 10 + LOT_QUANTITY_EPSILON / 2 })], 10)).toBe("complete");
  });

  test("NEGATIVE CONTROL: the epsilon is not so wide it hides a real gap", () => {
    expect(lotCoverage([lot({ quantity: 10.01 })], 10)).toBe("mismatched");
  });
});

describe("openQuantity and weightedCost", () => {
  test("open quantity sums the open lots", () => {
    expect(openQuantity([lot(), lot({ id: "l2", quantity: 5 })])).toBe(15);
  });

  test("one unknown size makes the total unavailable", () => {
    expect(openQuantity([lot(), lot({ id: "l2", quantity: null })])).toBeNull();
  });

  test("cost is weighted by size, not a mean of the per-share costs", () => {
    // A mean would let a one-share lot move the basis as much as a
    // thousand-share one.
    const out = weightedCost([lot({ quantity: 99, cost_per_share: 100 }), lot({ id: "l2", quantity: 1, cost_per_share: 200 })]);
    expect(out).toBeCloseTo(101, 6);
  });

  test("an unknown cost on any lot makes the basis unavailable", () => {
    expect(weightedCost([lot(), lot({ id: "l2", cost_per_share: null })])).toBeNull();
  });

  test("no open lots is null, not zero", () => {
    expect(weightedCost([])).toBeNull();
    expect(openQuantity([])).toBeNull();
  });

  test("NEGATIVE CONTROL: a complete set gives real numbers", () => {
    expect(typeof openQuantity([lot()])).toBe("number");
    expect(typeof weightedCost([lot()])).toBe("number");
  });
});

describe("holdingPeriod", () => {
  test("over a year is long-term", () => {
    expect(holdingPeriod({ acquired_at: "2025-01-15" }, AT)).toBe("long_term");
  });

  test("under a year is short-term", () => {
    expect(holdingPeriod({ acquired_at: "2026-06-01" }, AT)).toBe("short_term");
  });

  test("exactly one year is SHORT-term", () => {
    // The US rule is strictly more than one year. A sale on the anniversary is
    // short-term, and getting this backwards misstates a tax bill.
    expect(holdingPeriod({ acquired_at: "2025-09-05" }, AT)).toBe("short_term");
    expect(holdingPeriod({ acquired_at: "2025-09-04" }, AT)).toBe("long_term");
  });

  test("no acquisition date is NULL, not short-term", () => {
    // Defaulting to short-term looks conservative and is not: it understates
    // the after-tax value of a sale the user may be told to make, and it is a
    // claim about their tax position that nobody supplied.
    expect(holdingPeriod({ acquired_at: null }, AT)).toBeNull();
    expect(holdingPeriod({ acquired_at: "not a date" }, AT)).toBeNull();
    expect(holdingPeriod({ acquired_at: "2025-02-30" }, AT)).toBeNull();
  });

  test("a future acquisition date is null, not a zero-day hold", () => {
    expect(holdingPeriod({ acquired_at: "2027-01-01" }, AT)).toBeNull();
  });

  test("a closed lot is measured to its close, not to today", () => {
    expect(
      holdingPeriod({ acquired_at: "2025-01-15", closed_at: "2025-06-01T00:00:00Z" }, AT),
    ).toBe("short_term");
  });
});

describe("exitScope — the rule in one function", () => {
  const lots = [{ id: "l1" }, { id: "l2" }];

  test("an order naming a lot covers THAT lot", () => {
    expect(exitScope({ lot_id: "l2" }, lots)).toEqual({ kind: "lot", lotId: "l2" });
  });

  test("an order naming no lot covers the position", () => {
    expect(exitScope({ lot_id: null }, lots)).toEqual({ kind: "position" });
  });

  test("an order naming a lot that does not exist has NO scope", () => {
    // A dangling reference. Guessing either way would be worse than saying so:
    // "position" over-reports protection, "lot" under-reports it.
    expect(exitScope({ lot_id: "gone" }, lots)).toBeNull();
  });

  test("NEGATIVE CONTROL: a lot-scoped exit is never reported as position-wide", () => {
    // The exact defect rule 19 names.
    const scope = exitScope({ lot_id: "l1" }, lots);
    expect(scope).not.toEqual({ kind: "position" });
  });
});

describe("unprotectedQuantity", () => {
  const l1 = { ...lot(), id: "l1", quantity: 10 };
  const l2 = { ...lot(), id: "l2", quantity: 5 };

  test("a lot-scoped stop leaves the other lots unprotected", () => {
    // The whole point. Before this, a stop on l1 read as covering all 15.
    expect(unprotectedQuantity([l1, l2], [{ lot_id: "l1", quantity: 10 }], 15)).toBe(5);
  });

  test("a position-wide exit covers everything", () => {
    expect(unprotectedQuantity([l1, l2], [{ lot_id: null, quantity: 15 }], 15)).toBe(0);
  });

  test("no exits leaves the whole position unprotected", () => {
    expect(unprotectedQuantity([l1, l2], [], 15)).toBe(15);
  });

  test("unavailable when the lots do not account for the position", () => {
    // "3 shares unprotected" computed from a partial lot list is a
    // reassurance the data does not support.
    expect(unprotectedQuantity([l1], [], 15)).toBeNull();
    expect(unprotectedQuantity([], [], 15)).toBeNull();
    expect(unprotectedQuantity([l1, l2], [], null)).toBeNull();
  });

  test("a closed lot is neither protected nor at risk", () => {
    const closed = { ...lot(), id: "l3", quantity: 7, closed_at: "2026-08-01T00:00:00Z" };
    expect(unprotectedQuantity([l1, l2, closed], [{ lot_id: "l1", quantity: 10 }], 15)).toBe(5);
  });

  test("NEGATIVE CONTROL: full protection and none are different answers", () => {
    const none = unprotectedQuantity([l1, l2], [], 15);
    const all = unprotectedQuantity([l1, l2], [{ lot_id: null, quantity: 15 }], 15);
    expect(none).not.toBe(all);
  });
});
