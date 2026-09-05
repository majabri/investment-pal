// Formatting the values recharts hands back.
//
// recharts types a tooltip value as `number | string | (number | string)[]`,
// and from v3 the formatter signature widens it again with `undefined`. The
// app's money formatter takes a `number`, so something has to bridge the two.
//
// `fmtUSD` already handles the easy half: `undefined`, `null` and `NaN` all
// come back as an em dash. What it was never built for is the rest of what
// recharts can supply, because nothing used to hand it a non-number. Measured,
// not assumed:
//
//   fmtUSD(Infinity)      -> "$∞"                a money figure that is not one
//   fmtUSD("abc")         -> "abc"               a category label in a money slot
//   fmtUSD("128450")      -> "128450"            no "$", no separator — reads as
//                                                a different kind of number from
//                                                the properly-formatted figures
//                                                beside it
//   fmtUSD([1, 2])        -> "$1.00,$2.00"       a range rendered as two figures
//
// Those reach the screen through `String.prototype.toLocaleString` and
// `Array.prototype.toLocaleString`, which quietly ignore the currency options
// rather than failing. A tooltip is exactly where that goes unnoticed: it
// appears under the cursor, in the same style as every true figure beside it.
//
// So this narrows to one finite number or nothing, and the rest of the summary
// surface's rule applies — a figure with no basis is shown as absent.

import { fmtUSD } from "./finance";

/**
 * A value as recharts may supply it.
 *
 * Deliberately wider than recharts' own `ValueType`: a parameter that accepts
 * more is still assignable where a narrower one is expected, and widening here
 * means a recharts type change does not break the call sites again.
 */
export type ChartValue = number | string | readonly (number | string)[] | undefined | null;

/**
 * The single finite number in a chart value, or `null`.
 *
 * An array is `null` rather than its first element: recharts uses arrays for
 * ranges, and printing one end of a range as though it were the value would be
 * a confident wrong number, which is the failure this module exists to avoid.
 */
export function chartNumber(value: ChartValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    // recharts passes numeric strings through from some data shapes. Routing
    // them through `Number` is what gets them currency-formatted rather than
    // printed raw. A string that is not a number is a label, not a figure.
    if (value.trim() === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Money for a chart tooltip. An em dash when there is no number to show. */
export function fmtChartUSD(value: ChartValue): string {
  const n = chartNumber(value);
  return n === null ? "—" : fmtUSD(n);
}
