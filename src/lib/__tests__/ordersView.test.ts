// The sentences the orders panel says — the first screen to read
// `orders.ts` and `fills.ts` at all.
import { describe, expect, test } from "bun:test";

import type { Fill } from "@/lib/fills";
import type { OrderLike } from "@/lib/orders";
import {
  AVERAGE_PRICE_EPSILON,
  averageAgreement,
  committedSummary,
  fillSentence,
  fillSummary,
  ordersCoverageSentence,
  sideLabel,
  sortOrders,
  statusLabel,
} from "@/lib/ordersView";

const fill = (over: Partial<Fill> = {}): Fill => ({
  id: "f1",
  order_id: "o1",
  filled_at: "2026-03-01T14:30:00Z",
  quantity: 10,
  price: 100,
  fees: null,
  source: "imported",
  broker_ref: null,
  ...over,
});

const order = (over: Partial<OrderLike & { placed_at: string | null }> = {}) => ({
  status: "open",
  side: "buy",
  quantity: 100,
  filled_quantity: null,
  limit_price: 50,
  order_type: "limit",
  placed_at: "2026-03-01T09:00:00Z",
  ...over,
});

describe("labels", () => {
  test("NEGATIVE CONTROL: known vocabulary maps to text", () => {
    expect(statusLabel("partially_filled")).toBe("Partially filled");
    expect(sideLabel("buy_to_cover")).toBe("Buy to cover");
  });

  test("unknown is a REAL status with its own label, not a blank", () => {
    expect(statusLabel("unknown")).toBe("Status unknown");
  });

  test("a value outside the map falls back to the raw value, never to empty", () => {
    // The CHECK guarantees membership today; if the vocabulary grows before
    // this map does, the raw word is at least true.
    expect(statusLabel("future_status")).toBe("future_status");
    expect(sideLabel("x")).toBe("x");
  });
});

describe("fillSummary", () => {
  test("no fills is NOT_RECORDED, not 'under'", () => {
    // `reconcileFills([], 10)` would say `under` — arithmetically true and a
    // warning on every order on day one.
    expect(fillSummary([], { filled_quantity: 10 })).toEqual({ state: "not_recorded" });
  });

  test("NEGATIVE CONTROL: fills matching the roll-up are matched", () => {
    const s = fillSummary([fill({ quantity: 6 }), fill({ id: "f2", quantity: 4 })], {
      filled_quantity: 10,
    });
    expect(s).toEqual({ state: "recorded", count: 2, reconciliation: "matched", average: 100 });
  });

  test("the average is volume-weighted, not a mean of prices", () => {
    const s = fillSummary(
      [fill({ quantity: 100, price: 10 }), fill({ id: "f2", quantity: 1, price: 20 })],
      { filled_quantity: 101 },
    );
    expect(s.state).toBe("recorded");
    if (s.state === "recorded") expect(s.average).toBeCloseTo(10.099, 3);
  });

  test("over is reported, not clamped", () => {
    const s = fillSummary([fill({ quantity: 12 })], { filled_quantity: 10 });
    if (s.state === "recorded") expect(s.reconciliation).toBe("over");
    else throw new Error("expected recorded");
  });
});

describe("fillSentence", () => {
  test("not recorded says so without implying a discrepancy", () => {
    const text = fillSentence({ state: "not_recorded" });
    expect(text).toContain("No fills recorded");
    expect(text).not.toMatch(/more|fewer|exceed/i);
  });

  test("over names the likely cause", () => {
    const text = fillSentence({ state: "recorded", count: 2, reconciliation: "over", average: 1 });
    expect(text).toContain("EXCEED");
    expect(text).toContain("double import");
  });

  test("under does not read as an error", () => {
    // The normal state while fills are being entered.
    const text = fillSentence({ state: "recorded", count: 1, reconciliation: "under", average: 1 });
    expect(text).toContain("more filled than they account for");
    expect(text).not.toContain("EXCEED");
  });

  test("singular and plural both read", () => {
    expect(fillSentence({ state: "recorded", count: 1, reconciliation: "matched", average: 1 })).toContain("1 fill,");
    expect(fillSentence({ state: "recorded", count: 3, reconciliation: "matched", average: 1 })).toContain("3 fills,");
  });
});

describe("averageAgreement", () => {
  test("NEGATIVE CONTROL: equal averages agree", () => {
    expect(averageAgreement(10.1, 10.1)).toBe("agrees");
  });

  test("within half a cent agrees — brokers round to the cent", () => {
    expect(averageAgreement(10.099, 10.1)).toBe("agrees");
    expect(averageAgreement(10.104, 10.1)).toBe("agrees");
  });

  test("beyond it differs", () => {
    // Not asserted AT the boundary: `10.1 + 0.005 - 10.1` is a hair over
    // 0.005 in binary, and a test that depends on which side of that hair
    // it lands is a test of the FPU, not of the rule.
    expect(averageAgreement(10.1 + 2 * AVERAGE_PRICE_EPSILON, 10.1)).toBe("differs");
    expect(averageAgreement(10.11, 10.1)).toBe("differs");
  });

  test("either side unknown is UNKNOWN — neither agreement nor discrepancy", () => {
    expect(averageAgreement(null, 10.1)).toBe("unknown");
    expect(averageAgreement(10.1, null)).toBe("unknown");
    expect(averageAgreement(Number.NaN, 10.1)).toBe("unknown");
  });
});

describe("committedSummary", () => {
  test("NEGATIVE CONTROL: priced working buys total", () => {
    const s = committedSummary([order({ quantity: 100, limit_price: 50 }), order({ quantity: 10, limit_price: 20 })]);
    expect(s).toEqual({ working: 2, total: 5200, unpriced: 0 });
  });

  test("one unpriceable order makes the total NULL and is counted", () => {
    // "The total of the ones we could price" is not the committed total.
    const s = committedSummary([
      order({ quantity: 100, limit_price: 50 }),
      order({ order_type: "market", limit_price: null }),
    ]);
    expect(s.total).toBeNull();
    expect(s.unpriced).toBe(1);
    expect(s.working).toBe(2);
  });

  test("closed orders are not working and commit nothing", () => {
    const s = committedSummary([order({ status: "filled" }), order({ status: "cancelled" })]);
    expect(s).toEqual({ working: 0, total: 0, unpriced: 0 });
  });

  test("an UNKNOWN status is working — the assumption that does not free capital", () => {
    const s = committedSummary([order({ status: "unknown" })]);
    expect(s.working).toBe(1);
  });

  test("sells commit no cash and do not make the total unknown", () => {
    const s = committedSummary([order({ side: "sell", order_type: "market", limit_price: null })]);
    expect(s).toEqual({ working: 1, total: 0, unpriced: 0 });
  });
});

describe("ordersCoverageSentence", () => {
  test("not known and empty says an empty list is not 'no open orders'", () => {
    const text = ordersCoverageSentence(false, 0, 0);
    expect(text).toContain("Nobody has told the app");
    expect(text).toContain("not \"no open orders\"");
  });

  test("not known with rows on file says the list cannot be trusted as current", () => {
    const text = ordersCoverageSentence(false, 3, 2);
    expect(text).toContain("3 orders on file");
    expect(text).toContain("cannot state what is working now");
  });

  test("NEGATIVE CONTROL: known and none working says the source reported nothing open", () => {
    expect(ordersCoverageSentence(true, 5, 0)).toContain("reported nothing open");
  });

  test("known with working orders counts them", () => {
    expect(ordersCoverageSentence(true, 5, 1)).toBe("1 working order.");
    expect(ordersCoverageSentence(true, 5, 2)).toBe("2 working orders.");
  });
});

describe("sortOrders", () => {
  test("working first, then newest placed first", () => {
    const a = { ...order({ status: "filled", placed_at: "2026-03-05T00:00:00Z" }), id: "closed-new" };
    const b = { ...order({ status: "open", placed_at: "2026-03-01T00:00:00Z" }), id: "open-old" };
    const c = { ...order({ status: "open", placed_at: "2026-03-03T00:00:00Z" }), id: "open-new" };
    expect(sortOrders([a, b, c]).map((o) => o.id)).toEqual(["open-new", "open-old", "closed-new"]);
  });

  test("it does not mutate its input", () => {
    const input = [order({ status: "filled" }), order({ status: "open" })];
    const copy = input.slice();
    sortOrders(input);
    expect(input).toEqual(copy);
  });
});
