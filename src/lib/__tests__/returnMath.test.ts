// A deposit is not a return (PERF-001).
//
// The defect these exist for is not subtle and was shipping: `performance()`
// computed `latest.net - start.net` and printed it under "1 month" with a
// percentage beside it. Deposit $10,000 into a flat account and the app
// reported +10.0% performance.
//
// Every figure below is synthetic (ADR-APP-012 rules 23-25).
import { describe, expect, test } from "bun:test";
import { annualise, moneyWeightedReturn, timeWeightedReturn } from "@/lib/returnMath";

describe("timeWeightedReturn — the PERF-001 scenario", () => {
  // 100,000 flat all month. On the 15th, 10,000 is deposited. Nothing is
  // earned or lost on the investments at any point.
  const flatWithDeposit = [
    { date: "2026-01-01", net: 100_000 },
    { date: "2026-01-14", net: 100_000 },
    { date: "2026-01-15", net: 110_000 },
    { date: "2026-01-31", net: 110_000 },
  ];
  const deposit = [{ date: "2026-01-15", amount: 10_000 }];

  test("a deposit into a flat account is 0% return, not +10%", () => {
    // What the app used to report, and still reports as a CHANGE IN VALUE:
    const valueChange = (110_000 - 100_000) / 100_000;
    expect(valueChange).toBeCloseTo(0.1, 10);
    // What actually happened to the investments:
    expect(timeWeightedReturn(flatWithDeposit, deposit)).toBeCloseTo(0, 10);
  });

  test("a withdrawal from a flat account is 0% return, not −10%", () => {
    const series = [
      { date: "2026-01-01", net: 100_000 },
      { date: "2026-01-14", net: 100_000 },
      { date: "2026-01-15", net: 90_000 },
      { date: "2026-01-31", net: 90_000 },
    ];
    expect(timeWeightedReturn(series, [{ date: "2026-01-15", amount: -10_000 }])).toBeCloseTo(
      0,
      10,
    );
  });

  test("real return survives a deposit in the middle of it", () => {
    // Flat to the 15th, deposit 10,000, then 10% on the whole 110,000.
    const series = [
      { date: "2026-01-01", net: 100_000 },
      { date: "2026-01-14", net: 100_000 },
      { date: "2026-01-15", net: 110_000 },
      { date: "2026-01-31", net: 121_000 },
    ];
    expect(timeWeightedReturn(series, deposit)).toBeCloseTo(0.1, 10);
    // The value change would have said 21%.
    expect((121_000 - 100_000) / 100_000).toBeCloseTo(0.21, 10);
  });

  test("with no flows it agrees with the plain value change", () => {
    const series = [
      { date: "2026-01-01", net: 100_000 },
      { date: "2026-01-31", net: 110_000 },
    ];
    expect(timeWeightedReturn(series, [])).toBeCloseTo(0.1, 10);
  });

  test("linking is order-independent in a way a simple ratio is not", () => {
    // Same start, same end, same flow — but the deposit lands after a 10% gain
    // rather than before it. The value change is identical; the return is not.
    const early = [
      { date: "2026-01-01", net: 100_000 },
      { date: "2026-01-02", net: 110_000 }, // deposit, flat investments
      { date: "2026-01-31", net: 121_000 }, // +10% on 110,000
    ];
    const late = [
      { date: "2026-01-01", net: 100_000 },
      { date: "2026-01-02", net: 111_000 }, // +11% on 100,000, no deposit yet
      { date: "2026-01-31", net: 121_000 }, // deposit 10,000, investments flat
    ];
    const a = timeWeightedReturn(early, [{ date: "2026-01-02", amount: 10_000 }]);
    const b = timeWeightedReturn(late, [{ date: "2026-01-31", amount: 10_000 }]);
    expect(a).toBeCloseTo(0.1, 10);
    expect(b).toBeCloseTo(0.11, 10);
    // Identical endpoints, identical flow total, different returns — which is
    // exactly what a value-change figure cannot express.
    expect(a).not.toBeCloseTo(b as number, 3);
  });
});

describe("timeWeightedReturn — refusals", () => {
  test("one point is not 0% return", () => {
    expect(timeWeightedReturn([{ date: "2026-01-01", net: 100_000 }], [])).toBeNull();
    expect(timeWeightedReturn([], [])).toBeNull();
  });

  test("a sub-period starting from zero is undefined, not −100%", () => {
    const series = [
      { date: "2026-01-01", net: 0 },
      { date: "2026-01-31", net: 50_000 },
    ];
    expect(timeWeightedReturn(series, [])).toBeNull();
  });

  test("a withdrawal that empties the account breaks the link, and says so", () => {
    const series = [
      { date: "2026-01-01", net: 100_000 },
      { date: "2026-01-15", net: 0 },
      { date: "2026-01-31", net: 0 },
    ];
    // Base for the second sub-period is 0 + 0 = 0. Null, not a linked product
    // silently missing its first leg.
    expect(timeWeightedReturn(series, [{ date: "2026-01-15", amount: -100_000 }])).toBeNull();
  });

  test("a flow on the first date of the window is not counted twice", () => {
    // The window opens ON the deposit date, so the deposit is already inside
    // the opening value. The half-open (prev, curr] window is what makes that
    // true; a closed one would subtract it again and invent a loss.
    const series = [
      { date: "2026-01-15", net: 110_000 },
      { date: "2026-01-31", net: 121_000 },
    ];
    expect(timeWeightedReturn(series, [{ date: "2026-01-15", amount: 10_000 }])).toBeCloseTo(
      0.1,
      10,
    );
  });

  test("a non-finite value poisons nothing — it returns null", () => {
    const series = [
      { date: "2026-01-01", net: 100_000 },
      { date: "2026-01-31", net: Number.NaN },
    ];
    expect(timeWeightedReturn(series, [])).toBeNull();
  });
});

describe("moneyWeightedReturn", () => {
  test("no flows, one year, 10% gain → 10% annualised", () => {
    const r = moneyWeightedReturn(100_000, "2026-01-01", 110_000, "2027-01-01", []);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.1, 3);
  });

  test("timing matters, which is the whole point of it", () => {
    // Same money in, same money out, but the second contribution arrives late
    // in the year and therefore earns for less of it.
    const early = moneyWeightedReturn(100_000, "2026-01-01", 231_000, "2027-01-01", [
      { date: "2026-01-02", amount: 100_000 },
    ]);
    const late = moneyWeightedReturn(100_000, "2026-01-01", 231_000, "2027-01-01", [
      { date: "2026-12-01", amount: 100_000 },
    ]);
    expect(early).not.toBeNull();
    expect(late).not.toBeNull();
    // The late contribution had less time to produce the same ending value, so
    // the money that WAS invested must have earned a higher rate.
    expect(late!).toBeGreaterThan(early!);
  });

  test("a deposit into a flat account earns nothing", () => {
    const r = moneyWeightedReturn(100_000, "2026-01-01", 110_000, "2027-01-01", [
      { date: "2026-06-01", amount: 10_000 },
    ]);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0, 3);
  });

  test("null rather than a wrong number when there is no sign change", () => {
    // Everything is an inflow and the ending value is zero: no rate solves it.
    expect(moneyWeightedReturn(100_000, "2026-01-01", 0, "2027-01-01", [])).toBeNull();
  });

  test("null for a window shorter than a day", () => {
    expect(moneyWeightedReturn(100_000, "2026-01-01", 110_000, "2026-01-01", [])).toBeNull();
  });

  test("flows outside the window are ignored, not extrapolated", () => {
    const inside = moneyWeightedReturn(100_000, "2026-01-01", 110_000, "2027-01-01", [
      { date: "2025-06-01", amount: 50_000 },
      { date: "2028-06-01", amount: 50_000 },
    ]);
    const none = moneyWeightedReturn(100_000, "2026-01-01", 110_000, "2027-01-01", []);
    expect(inside).toBeCloseTo(none as number, 9);
  });

  test("a loss is a negative rate, not a refusal", () => {
    const r = moneyWeightedReturn(100_000, "2026-01-01", 80_000, "2027-01-01", []);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(-0.2, 3);
  });
});

describe("annualise", () => {
  test("a one-year period return is itself", () => {
    expect(annualise(0.1, 365)).toBeCloseTo(0.1, 9);
  });

  test("a one-month 10% compounds to far more than 10%", () => {
    const r = annualise(0.1, 30);
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(2); // >200%, which is why the unit must be said
  });

  test("null for a total loss and for a sub-day period", () => {
    expect(annualise(-1, 365)).toBeNull();
    expect(annualise(0.1, 0)).toBeNull();
    expect(annualise(null, 365)).toBeNull();
  });
});
