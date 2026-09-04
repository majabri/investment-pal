// A tooltip is where a nonsense figure goes unnoticed — it appears under the
// cursor in the same style as every true figure beside it.
//
// `fmtUSD` already returns an em dash for undefined/null/NaN. The cases below
// are the ones it was never built for, because until recharts' loosely-typed
// value reached it, nothing handed it a non-number. Each expectation was
// measured against `fmtUSD` first, not assumed.
import { describe, expect, test } from "bun:test";

import { chartNumber, fmtChartUSD } from "../chartFormat";
import { fmtUSD } from "../finance";

describe("chartNumber", () => {
  test("a finite number is itself", () => {
    expect(chartNumber(53_938.35)).toBe(53_938.35);
    expect(chartNumber(0)).toBe(0);
    expect(chartNumber(-6_664.33)).toBe(-6_664.33);
  });

  test("a numeric string is read as a number", () => {
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
    expect(chartNumber(Number.NEGATIVE_INFINITY)).toBeNull();
  });

  test("a range array is null, not one end of the range", () => {
    // Printing one end as though it were the value would be a confident wrong
    // number — exactly what this module exists to avoid.
    expect(chartNumber([10, 20])).toBeNull();
  });
});

describe("fmtChartUSD covers what fmtUSD alone does not", () => {
  test("infinity is absent, not \"$∞\"", () => {
    // `fmtUSD` guards NaN but not Infinity, so it formats it as currency.
    expect(fmtUSD(Number.POSITIVE_INFINITY)).toBe("$∞");
    expect(fmtChartUSD(Number.POSITIVE_INFINITY)).toBe("—");
  });

  test("a category label is absent, not printed raw in a money slot", () => {
    // `String.prototype.toLocaleString` ignores the currency options rather
    // than failing, so the label reaches the screen unformatted.
    expect(fmtUSD("abc" as never)).toBe("abc");
    expect(fmtChartUSD("abc")).toBe("—");
  });

  test("a numeric string comes out currency-formatted, not raw", () => {
    // The subtle one: passed straight to `fmtUSD` it renders with no "$" and no
    // thousands separator, so it reads as a different kind of number from the
    // properly-formatted figures beside it.
    expect(fmtUSD("53938.35" as never)).toBe("53938.35");
    expect(fmtChartUSD("53938.35")).toBe("$53,938.35");
  });

  test("a range is absent, not two figures jammed together", () => {
    expect(fmtUSD([1, 2] as never)).toBe("$1.00,$2.00");
    expect(fmtChartUSD([1, 2])).toBe("—");
  });

  test("the cases fmtUSD already handled still come out as an em dash", () => {
    for (const v of [undefined, null, Number.NaN] as const) {
      expect(fmtChartUSD(v)).toBe("—");
    }
  });

  test("a real figure formats as money, and zero is a figure", () => {
    expect(fmtChartUSD(53_938.35)).toBe("$53,938.35");
    // A genuine $0.00 must not be swallowed by the em-dash path.
    expect(fmtChartUSD(0)).toBe("$0.00");
  });
});
