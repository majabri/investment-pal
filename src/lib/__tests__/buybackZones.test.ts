import { describe, expect, test } from "bun:test";
import { activeBuybackBySymbol, computeBuyback, isBuybackEligible } from "../buybackZones";

const trim = {
  id: "trim-1",
  symbol: "MSFT",
  action: "TRIM",
  recommendation: "Trim after the position became extended",
  price_at_rec: 100,
  decided_on: "2026-01-01",
};

describe("buy-back zones", () => {
  test("creates the approved re-entry zones and marks reached zones", () => {
    const plan = computeBuyback(trim, 94, new Date("2026-01-10T12:00:00Z"));

    expect(plan).toMatchObject({
      symbol: "MSFT",
      anchor: 100,
      expired: false,
      zones: [
        { pct: -5, price: 95, status: "hit" },
        { pct: -10, price: 90, status: "pending" },
        { pct: -15, price: 85, status: "pending" },
      ],
    });
  });

  test("does not attach zones to thesis-break or full-sale decisions", () => {
    expect(
      isBuybackEligible({ ...trim, recommendation: "Trim because the thesis is broken" }),
    ).toBe(false);
    expect(isBuybackEligible({ ...trim, action: "SELL", recommendation: "Sell all" })).toBe(false);
  });

  test("keeps only the newest active plan for each symbol", () => {
    const plans = activeBuybackBySymbol(
      [
        trim,
        { ...trim, id: "trim-2", decided_on: "2026-01-15" },
        { ...trim, id: "expired", symbol: "NVDA", decided_on: "2025-11-01" },
      ],
      () => 98,
      new Date("2026-01-20T12:00:00Z"),
    );

    expect(plans.get("MSFT")?.decisionId).toBe("trim-2");
    expect(plans.has("NVDA")).toBe(false);
  });
});
