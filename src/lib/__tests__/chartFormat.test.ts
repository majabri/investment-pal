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
    expect(chartNumber(128_450)).toBe(128_450);
    expect(chartNumber(0)).toBe(0);
    expect(chartNumber(-20_000)).toBe(-20_000);
  });

  test("a numeric string is read as a number", () => {
    expect(chartNumber("128450")).toBe(128_450);
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
  // These four documented what `fmtUSD` did with hostile input, as the foil for
  // what `fmtChartUSD` does instead. Phase 3 gave `fmtUSD` a non-finite guard,
  // which closed three of them at the source — a category label can no longer
  // reach a money slot raw. They are kept, and now assert the new contract:
  // `fmtUSD` REFUSES what it cannot format, and `fmtChartUSD` is what knows how
  // to recover a value from recharts' several shapes.
  test("infinity is refused rather than formatted as currency", () => {
    expect(fmtUSD(Number.POSITIVE_INFINITY)).toBe("(error)");
    // "(error)" is right for a defect and wrong for a chart point that simply
    // has no value, which is what the em dash means here.
    expect(fmtChartUSD(Number.POSITIVE_INFINITY)).toBe("—");
  });

  test("a category label is refused, not printed raw in a money slot", () => {
    // `String.prototype.toLocaleString` ignores the currency options rather
    // than failing, so before the guard the label reached the screen
    // unformatted, looking like data.
    expect(fmtUSD("abc" as never)).toBe("(error)");
    expect(fmtChartUSD("abc")).toBe("—");
  });

  test("only fmtChartUSD recovers a numeric string", () => {
    // The reason this module still earns its keep. `fmtUSD` now refuses the
    // string outright rather than rendering it with no "$" and no thousands
    // separator, so it can no longer read as a different kind of number from
    // the figures beside it — but refusing is not the right answer for a chart,
    // where recharts legitimately passes numbers through as strings.
    expect(fmtUSD("128450" as never)).toBe("(error)");
    expect(fmtChartUSD("128450")).toBe("$128,450.00");
  });

  test("a range is refused, not two figures jammed together", () => {
    expect(fmtUSD([1, 2] as never)).toBe("(error)");
    expect(fmtChartUSD([1, 2])).toBe("—");
  });

  test("the cases fmtUSD already handled still come out as an em dash", () => {
    for (const v of [undefined, null, Number.NaN] as const) {
      expect(fmtChartUSD(v)).toBe("—");
    }
  });

  test("a real figure formats as money, and zero is a figure", () => {
    expect(fmtChartUSD(128_450)).toBe("$128,450.00");
    // A genuine $0.00 must not be swallowed by the em-dash path.
    expect(fmtChartUSD(0)).toBe("$0.00");
  });
});
