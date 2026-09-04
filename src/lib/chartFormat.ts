// Formatting the values recharts hands back.
//
// recharts types a tooltip value as `number | string | (number | string)[]`,
// and from v3 the formatter signature widens it again with `undefined`. The
// app's money formatter takes a `number`, so something has to bridge the two —
// and the interesting question is what to print when the bridge finds no
// number.
//
// It prints an em dash. `fmtUSD(Number(undefined))` renders "$NaN", and a chart
// tooltip is exactly where a nonsense figure gets read as real: it appears
// under the cursor, in the same style as every true figure beside it. This
// follows the rule the rest of the summary surface already obeys — a figure
// with no basis is shown as absent, never as a number.

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
    // recharts passes numeric strings through from some data shapes. A string
    // that is not a number (a category label) is not a figure.
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
