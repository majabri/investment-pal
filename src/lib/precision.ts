// Precision by instrument (Phase 7, rule 33).
//
// "No global two-decimal rounding. Stocks, ETFs, options, crypto, penny
// securities, FX each have their own needs. Preserve source precision in
// calculations; round only for presentation."
//
// `fmtUSD(v, digits = 2)` is the global two-decimal rounding, and it is called
// everywhere. Where that actually costs something:
//
//   * CRYPTO. A holding priced at $0.00003412 renders as "$0.00" — not a
//     rounding error, an erasure. Multiply it by a quantity with eight
//     decimals of its own and the position appears to be worth nothing.
//   * PENNY SECURITIES. $0.0042 and $0.0038 both render "$0.00", so a 10%
//     move is invisible on the screen that exists to show moves.
//   * FX. Rates are quoted to four or five decimals; two makes 1.0854 and
//     1.0851 the same number, and a conversion built on that is wrong by 3
//     basis points before anything else happens.
//   * OPTIONS. Contracts under $3 trade in cents, above in nickels, and
//     quantity is CONTRACTS — a fractional option quantity is a parse error,
//     not a small position.
//
// The rule this module encodes: **precision is a property of the instrument,
// not of the renderer**, and rounding happens at the last possible moment. A
// calculation that rounds is a calculation that has decided how the answer
// will be displayed, which is not its business.
//
// Pure: no React, no Supabase client, no formatting locale assumptions beyond
// the caller's.

/**
 * What kind of thing a figure describes.
 *
 * `unknown` is deliberately present and deliberately NOT defaulted to
 * `equity`. An instrument whose class nobody recorded gets the MOST precision
 * available rather than the most common — losing digits is irreversible, and
 * showing more than needed is merely untidy. That asymmetry is the whole
 * argument for the default below.
 */
export const INSTRUMENT_CLASSES = [
  "equity",
  "etf",
  "fund",
  "option",
  "crypto",
  "penny",
  "fx",
  "unknown",
] as const;
export type InstrumentClass = (typeof INSTRUMENT_CLASSES)[number];

/**
 * Decimals to SHOW for a price. Never used in arithmetic.
 *
 * These are conventions of the instruments, not tuned parameters, and none is
 * derived from any portfolio's size (rule 31): a $500 crypto position and a
 * $5,000,000 one both need eight decimals on the unit price.
 */
export const PRICE_DECIMALS: Record<InstrumentClass, number> = {
  equity: 2,
  etf: 2,
  // NAV is published to four; funds priced daily can move in the third and
  // fourth decimal and a two-decimal view hides it.
  fund: 4,
  // Contracts under $3 quote in cents; two decimals covers the convention.
  option: 2,
  // Satoshi-scale. This is the case where two decimals erases the figure.
  crypto: 8,
  // Sub-dollar securities move meaningfully in the third and fourth decimal.
  penny: 4,
  // Rates are quoted to four or five.
  fx: 5,
  // See the note on the type: unknown gets the most, because losing digits is
  // irreversible and showing extra is only untidy.
  unknown: 8,
};

/**
 * Decimals to SHOW for a quantity.
 *
 * Options are whole contracts. A fractional option quantity is a parse error
 * or a units mix-up, and rounding it to a whole number for display would hide
 * exactly that.
 */
export const QUANTITY_DECIMALS: Record<InstrumentClass, number> = {
  equity: 6,
  etf: 6,
  fund: 6,
  option: 0,
  crypto: 8,
  penny: 6,
  fx: 2,
  unknown: 8,
};

/**
 * A best-effort class from what the app actually knows.
 *
 * Deliberately conservative: it only claims a class it can justify, and
 * everything else is `unknown` — which, per the table above, keeps the most
 * precision. This is NOT the place to grow a symbol-pattern classifier; rule 8
 * forbids inferring behaviour from a label, and a ticker is a label. The real
 * source is an instrument record the broker adapter supplies, which does not
 * exist yet and is honestly absent rather than faked.
 */
export function classOf(instrument: {
  instrument_class?: string | null;
  /** Last known unit price, used ONLY for the penny-security case below. */
  price?: number | null;
}): InstrumentClass {
  const declared = instrument.instrument_class;
  if (declared && (INSTRUMENT_CLASSES as readonly string[]).includes(declared)) {
    return declared as InstrumentClass;
  }
  // The one inference worth making, and it is about the FIGURE rather than
  // about the instrument's identity: a unit price below a dollar cannot be
  // shown to two decimals without losing the part that moves. This does not
  // claim the thing IS a penny security — it claims two decimals would erase
  // information, which is all the renderer needs to know.
  const p = instrument.price;
  if (typeof p === "number" && Number.isFinite(p) && p !== 0 && Math.abs(p) < 1) {
    return "penny";
  }
  return "unknown";
}

/**
 * Decimals that keep a specific figure legible, never fewer than its class.
 *
 * The class table is a floor, not a ceiling. A "penny" price of 0.00004 still
 * needs more than four decimals, and a rule that stopped at the class default
 * would render it "$0.0000" — the same erasure in a different coat.
 *
 * Capped, because a float's tail is noise rather than precision: 0.1 + 0.2
 * displayed to twenty decimals is a lie about how much is known.
 */
export const MAX_DISPLAY_DECIMALS = 10;

export function displayDecimals(value: number, cls: InstrumentClass): number {
  const floor = PRICE_DECIMALS[cls];
  if (!Number.isFinite(value) || value === 0) return floor;
  const abs = Math.abs(value);
  if (abs >= 1) return floor;
  // Enough decimals to show at least three significant figures.
  const leadingZeros = Math.floor(-Math.log10(abs));
  return Math.min(MAX_DISPLAY_DECIMALS, Math.max(floor, leadingZeros + 3));
}

/**
 * Round a figure FOR PRESENTATION.
 *
 * Named for what it is, so a call site that reaches for it inside a
 * calculation reads as wrong. Rule 33's "preserve source precision in
 * calculations" is not enforceable by a type — it is enforceable by making the
 * rounding function say out loud that it is a display concern, and by the
 * source guard in `precision.test.ts` that no engine module calls it.
 */
export function roundForDisplay(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  // NOT `Math.round(value * 10**d) / 10**d`. That is the obvious form and it
  // is wrong at exactly the boundary a person checks: 1.005 * 100 is
  // 100.49999999999999 in binary floating point, so the obvious form rounds
  // 1.005 down to 1.00 and somebody reports a penny missing. Going through the
  // decimal string moves the point without a multiplication, which is what the
  // exponent notation is for.
  const shifted = Number(`${value}e${decimals}`);
  if (!Number.isFinite(shifted)) return value;
  const rounded = Number(`${Math.round(shifted)}e-${decimals}`);
  return Number.isFinite(rounded) ? rounded : value;
}

/**
 * Modules that compute money and must never round.
 *
 * Listed here rather than only in the test so the rule is readable from the
 * code it constrains. Rounding inside these is how a total stops matching the
 * figures it was built from — and reconciliation then reports a discrepancy
 * that the app itself introduced.
 */
export const NON_ROUNDING_MODULES = [
  "src/lib/accountTotals.ts",
  "src/lib/accountAggregate.ts",
  "src/lib/reconciliation.ts",
  "src/lib/canonicalBalances.ts",
  "src/lib/orders.ts",
  "src/lib/lots.ts",
  "src/lib/objectiveMath.ts",
] as const;
