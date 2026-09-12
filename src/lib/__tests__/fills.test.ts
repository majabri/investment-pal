// §12.3, and §26.2's "partial fill updates exactly once".
//
// That mandatory data-state test could not be written before this: the schema
// collapsed every execution into `orders.filled_quantity` and
// `orders.average_fill_price`, so two partials were indistinguishable from one
// partial entered twice, and fees had nowhere to exist at all.
import { describe, expect, test } from "bun:test";

import {
  averageFillPrice,
  canRecordFill,
  fillRejection,
  fillTotals,
  reconcileFills,
} from "@/lib/fills";
import type { Fill } from "@/lib/fills";

const fill = (over: Partial<Fill> = {}): Fill => ({
  id: "f1",
  order_id: "o1",
  filled_at: "2026-09-01T14:30:00Z",
  quantity: 100,
  price: 25,
  fees: 1.5,
  source: "imported",
  broker_ref: null,
  ...over,
});

describe("fillTotals", () => {
  test("NEGATIVE CONTROL: two fills add up", () => {
    // Without this, every refusal below passes on a function returning null
    // for everything.
    const t = fillTotals([fill(), fill({ id: "f2", quantity: 50, price: 26 })]);
    expect(t.quantity).toBe(150);
    expect(t.value).toBeCloseTo(100 * 25 + 50 * 26, 6);
    expect(t.count).toBe(2);
  });

  test("two partials ADD — they do not replace each other", () => {
    // The defect the roll-up invited. On the order's two columns, the second
    // partial overwrites the first and 150 filled shares read as 50.
    const one = fillTotals([fill({ quantity: 100 })]);
    const two = fillTotals([fill({ quantity: 100 }), fill({ id: "f2", quantity: 50 })]);
    expect(two.quantity! - one.quantity!).toBe(50);
  });

  test("unknown fees make the TOTAL unknown, not smaller", () => {
    // All-or-nothing. Summing the fees that happen to be recorded understates
    // the cost by exactly the missing ones, with nothing to show for it.
    const t = fillTotals([fill({ fees: 1.5 }), fill({ id: "f2", fees: null })]);
    expect(t.fees).toBeNull();
    // The quantity is still perfectly knowable — unknown propagates per field.
    expect(t.quantity).toBe(200);
  });

  test("a real zero fee is a fact and survives", () => {
    expect(fillTotals([fill({ fees: 0 })]).fees).toBe(0);
  });

  test("an unusable fill makes the quantity unknown", () => {
    // A partially-known total is worse than none: it looks like a smaller
    // position rather than an uncertain one.
    for (const bad of [{ quantity: 0 }, { quantity: -5 }, { price: 0 }, { quantity: Number.NaN }]) {
      const t = fillTotals([fill(), fill({ id: "f2", ...bad })]);
      expect(t.quantity).toBeNull();
      expect(t.value).toBeNull();
    }
  });

  test("count is fills, not shares", () => {
    // Two fills can total one share; conflating them would make a partial
    // import look complete.
    expect(fillTotals([fill({ quantity: 0.5 }), fill({ id: "f2", quantity: 0.5 })]).count).toBe(2);
  });
});

describe("averageFillPrice is volume-weighted", () => {
  test("100 at $10 and 1 at $20 averages to $10.10, not $15", () => {
    // The unweighted mean is the classic way a blended cost comes out wrong in
    // favour of the smallest fill.
    const avg = averageFillPrice([
      fill({ quantity: 100, price: 10 }),
      fill({ id: "f2", quantity: 1, price: 20 }),
    ]);
    expect(avg).toBeCloseTo(1020 / 101, 10);
    expect(avg).not.toBeCloseTo(15, 1);
  });

  test("fees are NOT folded into the price", () => {
    // An average with costs baked in is neither a price nor a cost, and
    // reconciling it against the broker's average would show a false gap.
    const withFees = averageFillPrice([fill({ quantity: 10, price: 50, fees: 100 })]);
    expect(withFees).toBe(50);
  });

  test("no usable fills gives NULL, never 0", () => {
    expect(averageFillPrice([])).toBeNull();
    expect(averageFillPrice([fill({ quantity: 0 })])).toBeNull();
  });
});

describe("reconcileFills", () => {
  test("agreement inside the epsilon is matched", () => {
    expect(reconcileFills([fill({ quantity: 100 })], 100)).toBe("matched");
    expect(reconcileFills([fill({ quantity: 100 })], 100 + 1e-9)).toBe("matched");
  });

  test("an over-fill is surfaced, not clamped", () => {
    // Clamping would hide a double-imported statement — the exact failure the
    // idempotency index exists to prevent.
    expect(reconcileFills([fill({ quantity: 100 }), fill({ id: "f2", quantity: 100 })], 100)).toBe(
      "over",
    );
  });

  test("fills still being entered read as under, not as an error", () => {
    expect(reconcileFills([fill({ quantity: 50 })], 100)).toBe("under");
  });

  test("either side unknown is unknown", () => {
    expect(reconcileFills([fill()], null)).toBe("unknown");
    expect(reconcileFills([fill({ quantity: Number.NaN })], 100)).toBe("unknown");
  });

  test("no fills against a filled order is under, not matched", () => {
    // Zero recorded fills against an order the broker says filled is a gap in
    // the ledger. Calling it matched would report a reconciled position that
    // has no execution record at all.
    expect(reconcileFills([], 100)).toBe("under");
  });
});

describe("fillRejection — partial fill updates EXACTLY once (§26.2)", () => {
  const good = { quantity: 100, price: 25, fees: 1.5, broker_ref: "ABC123" };

  test("NEGATIVE CONTROL: a first fill is accepted", () => {
    expect(fillRejection(good, [])).toBeNull();
    expect(canRecordFill(good, [])).toBe(true);
  });

  test("the same broker reference twice is refused", () => {
    // THE mandatory test. Re-importing a statement must not double a position.
    const existing = [fill({ broker_ref: "ABC123" })];
    expect(fillRejection(good, existing)).toBe("duplicate_broker_ref");
  });

  test("references compare case-insensitively", () => {
    // Brokers are not consistent, and two rows differing only in case are the
    // same execution imported twice.
    const existing = [fill({ broker_ref: "abc123" })];
    expect(fillRejection({ ...good, broker_ref: "ABC123  " }, existing)).toBe(
      "duplicate_broker_ref",
    );
  });

  test("a DIFFERENT reference on the same order is a real second partial", () => {
    // The other half of the rule. Refusing this would make a genuinely partial
    // execution unrecordable, which is the opposite defect.
    const existing = [fill({ broker_ref: "ABC123" })];
    expect(fillRejection({ ...good, broker_ref: "DEF456" }, existing)).toBeNull();
  });

  test("two hand-entered fills with no reference are both allowed", () => {
    // NULL references cannot collide. The index is partial for the same
    // reason: a person entering two partials by hand is doing it correctly.
    const existing = [fill({ broker_ref: null })];
    expect(fillRejection({ ...good, broker_ref: null }, existing)).toBeNull();
  });

  test("a zero or negative quantity is not a fill", () => {
    expect(fillRejection({ ...good, quantity: 0 }, [])).toBe("not_a_quantity");
    expect(fillRejection({ ...good, quantity: -1 }, [])).toBe("not_a_quantity");
    expect(fillRejection({ ...good, quantity: null }, [])).toBe("not_a_quantity");
  });

  test("nothing fills at zero", () => {
    expect(fillRejection({ ...good, price: 0 }, [])).toBe("not_a_price");
  });

  test("a negative fee is a rebate, and belongs in cash_flows", () => {
    expect(fillRejection({ ...good, fees: -5 }, [])).toBe("negative_fees");
    // Unknown fees are fine — NULL is NOT KNOWN, which the totals propagate.
    expect(fillRejection({ ...good, fees: null }, [])).toBeNull();
  });
});
