// The tooltip is where a nonsense figure gets read as real — it appears under
// the cursor in the same style as every true figure beside it.
import { describe, expect, test } from "bun:test";

import { chartNumber, fmtChartUSD } from "../chartFormat";

describe("chartNumber", () => {
  test("a finite number is itself", () => {
    expect(chartNumber(53_938.35)).toBe(53_938.35);
    expect(chartNumber(0)).toBe(0);
    expect(chartNumber(-6_664.33)).toBe(-6_664.33);
  });

  test("a numeric string is read as a number", () => {
    // recharts passes these through from some data shapes.
    expect(chartNumber("53938.35")).toBe(53_938.35);
  });

  test("a non-numeric string is not a figure", () => {
    expect(chartNumber("Account value")).toBeNull();
    expect(chartNumber("")).toBeNull();
    expect(chartNumber("   ")).toBeNull();
  });

  test("absent is null, and so is a non-finite number", () => {
    expect(chartNumber(undefined)).toBeNull();
    expect(chartNumber(null)).toBeNull();
    expect(chartNumber(Number.NaN)).toBeNull();
    expect(chartNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });

  test("a range array is null, not one end of the range", () => {
    // Printing one end as though it were the value would be a confident wrong
    // number — exactly what this module exists to avoid.
    expect(chartNumber([10, 20])).toBeNull();
  });
});

describe("fmtChartUSD", () => {
  test("formats a real figure as money", () => {
    expect(fmtChartUSD(53_938.35)).toContain("53,938");
  });

  test("renders an em dash rather than $NaN", () => {
    // The whole point. `fmtUSD(Number(undefined))` gives "$NaN", which reads as
    // a real figure to anyone glancing at a tooltip.
    for (const v of [undefined, null, Number.NaN, "not a number", [1, 2]] as const) {
      expect(fmtChartUSD(v)).toBe("—");
    }
  });

  test("zero is a figure, not an absence", () => {
    // A genuine $0.00 must not be swallowed by the em-dash path.
    expect(fmtChartUSD(0)).not.toBe("—");
  });
});
