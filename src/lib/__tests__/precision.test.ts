// Phase 7, rules 33 and 32.
//
// Rule 33: "No global two-decimal rounding. Stocks, ETFs, options, crypto,
// penny securities, FX each have their own needs. Preserve source precision in
// calculations; round only for presentation."
//
// Rule 32: "Preserve account currency, instrument currency, source currency,
// FX rate, FX as-of, base-currency value. A USD-only implementation is
// acceptable; a USD-ASSUMED ARCHITECTURE is not."
//
// The global two-decimal rounding was `fmtUSD(v, digits = 2)`, called from
// every screen, with `currency: "USD"` written inline. Both defects in one
// function.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  INSTRUMENT_CLASSES,
  MAX_DISPLAY_DECIMALS,
  NON_ROUNDING_MODULES,
  PRICE_DECIMALS,
  QUANTITY_DECIMALS,
  classOf,
  displayDecimals,
  roundForDisplay,
} from "../precision";
import { fmtMoney, fmtPrice, fmtQuantity, fmtUSD } from "../finance";
import {
  PRESENTATION_CURRENCY,
  accountCurrency,
  convert,
  isCurrencyCode,
  money,
  sumMoney,
} from "../currency";

const NOW = new Date("2026-09-05T12:00:00Z");

describe("precision is a property of the instrument", () => {
  test("every class has price and quantity decimals", () => {
    for (const c of INSTRUMENT_CLASSES) {
      expect(typeof PRICE_DECIMALS[c]).toBe("number");
      expect(typeof QUANTITY_DECIMALS[c]).toBe("number");
    }
  });

  test("crypto keeps satoshi scale, equities do not need it", () => {
    expect(PRICE_DECIMALS.crypto).toBeGreaterThanOrEqual(8);
    expect(PRICE_DECIMALS.equity).toBe(2);
  });

  test("options are whole contracts", () => {
    // A fractional option quantity is a parse error or a units mix-up.
    // Rounding it for display would hide exactly that.
    expect(QUANTITY_DECIMALS.option).toBe(0);
  });

  test("FX is quoted to more than two", () => {
    // Two decimals makes 1.0854 and 1.0851 the same number, and a conversion
    // built on that is wrong by three basis points before anything else.
    expect(PRICE_DECIMALS.fx).toBeGreaterThanOrEqual(4);
  });

  test("UNKNOWN gets the MOST precision, not the most common", () => {
    // The asymmetry that decides the default: losing digits is irreversible,
    // showing extra is merely untidy.
    expect(PRICE_DECIMALS.unknown).toBeGreaterThanOrEqual(
      Math.max(...INSTRUMENT_CLASSES.map((c) => PRICE_DECIMALS[c])),
    );
  });
});

describe("classOf", () => {
  test("a declared class is used", () => {
    expect(classOf({ instrument_class: "crypto" })).toBe("crypto");
  });

  test("an unrecognised class is unknown, not equity", () => {
    expect(classOf({ instrument_class: "widget" })).toBe("unknown");
    expect(classOf({})).toBe("unknown");
  });

  test("a sub-dollar price is treated as needing more decimals", () => {
    // Not a claim that the thing IS a penny security — a claim that two
    // decimals would erase the part that moves, which is all the renderer
    // needs to know.
    expect(classOf({ price: 0.0042 })).toBe("penny");
  });

  test("it does NOT classify from the ticker", () => {
    // Rule 8: never infer behaviour from a label, and a symbol is a label.
    // The real source is an instrument record the adapter supplies, which
    // does not exist yet and is honestly absent rather than faked.
    const src = readFileSync("src/lib/precision.ts", "utf8");
    expect(src).not.toMatch(/symbol\s*\./);
    expect(src).not.toMatch(/\.endsWith\(|\.startsWith\(/);
  });

  test("zero is not a penny price", () => {
    expect(classOf({ price: 0 })).toBe("unknown");
  });
});

describe("displayDecimals", () => {
  test("the class table is a FLOOR, not a ceiling", () => {
    // A "penny" price of 0.00004 still needs more than four decimals; a rule
    // that stopped at the class default would render "$0.0000" — the same
    // erasure in a different coat.
    expect(displayDecimals(0.00004, "penny")).toBeGreaterThan(PRICE_DECIMALS.penny);
  });

  test("ordinary prices use the class default", () => {
    expect(displayDecimals(401.22, "equity")).toBe(2);
    expect(displayDecimals(1, "equity")).toBe(2);
  });

  test("it is capped, because a float's tail is noise", () => {
    // 0.1 + 0.2 shown to twenty decimals is a lie about how much is known.
    expect(displayDecimals(1e-30, "crypto")).toBeLessThanOrEqual(MAX_DISPLAY_DECIMALS);
  });

  test("zero and non-finite fall back to the class floor", () => {
    expect(displayDecimals(0, "equity")).toBe(2);
    expect(displayDecimals(NaN, "equity")).toBe(2);
  });
});

describe("the formatters stop erasing figures", () => {
  test("a crypto price survives, where fmtUSD erased it", () => {
    // The defect, demonstrated side by side.
    expect(fmtUSD(0.00003412)).toBe("$0.00");
    expect(fmtPrice(0.00003412, { instrument_class: "crypto" })).not.toBe("$0.00");
    expect(fmtPrice(0.00003412, { instrument_class: "crypto" })).toContain("3412");
  });

  test("a 10% move in a penny security is visible", () => {
    const a = fmtPrice(0.0042, { instrument_class: "penny" });
    const b = fmtPrice(0.0038, { instrument_class: "penny" });
    expect(a).not.toBe(b);
    // Both would have been "$0.00".
    expect(fmtUSD(0.0042)).toBe(fmtUSD(0.0038));
  });

  test("an ordinary equity price is unchanged", () => {
    // The change must not churn the 99% case.
    expect(fmtPrice(401.22, { instrument_class: "equity" })).toBe(fmtUSD(401.22));
  });

  test("option quantities show as whole contracts", () => {
    expect(fmtQuantity(3, { instrument_class: "option" })).toBe("3");
  });

  test("fractional shares survive", () => {
    expect(fmtQuantity(1.255, { instrument_class: "equity" })).toBe("1.255");
  });

  test("non-finite input is an error, not a figure", () => {
    expect(fmtPrice(NaN)).toBe("(error)");
    expect(fmtQuantity(Infinity)).toBe("(error)");
  });
});

describe("currency is stated, not assumed", () => {
  test("fmtUSD delegates rather than writing the code inline", () => {
    // One place where a currency code becomes a symbol.
    //
    // Comments stripped first. The comment in `finance.ts` EXPLAINS that
    // `currency: "USD"` used to be written inline, and has to quote it to do
    // so — instance nine of a guard firing on its own explanation, caught on
    // the first run. A guard that pressures the next person to delete the
    // reason is worse than no guard.
    const src = readFileSync("src/lib/finance.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    const matches = src.match(/currency:\s*["']USD["']/g) ?? [];
    expect(matches).toEqual([]);
  });

  test("NEGATIVE CONTROL: stripping comments does not blank finance.ts", () => {
    const src = readFileSync("src/lib/finance.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(src).toContain("fmtMoney");
    expect(src).toContain("fmtUSD");
  });

  test("NEGATIVE CONTROL: that pattern matches the line that was removed", () => {
    expect(`    currency: "USD",`).toMatch(/currency:\s*["']USD["']/);
  });

  test("fmtMoney honours the currency it is given", () => {
    expect(fmtMoney(100, "GBP")).toContain("£");
    expect(fmtMoney(100, "EUR")).not.toContain("$");
  });

  test("accountCurrency is null when unset, never USD", () => {
    // `accounts.currency` has been nullable with no default since Phase 1c
    // precisely so this could be honest.
    expect(accountCurrency({ currency: null })).toBeNull();
    expect(accountCurrency({ currency: "  " })).toBeNull();
    expect(accountCurrency(null)).toBeNull();
    expect(accountCurrency({ currency: "gbp" })).toBe("GBP");
  });

  test("isCurrencyCode checks shape, not a list", () => {
    expect(isCurrencyCode("USD")).toBe(true);
    expect(isCurrencyCode("usd")).toBe(true);
    // The actual failure mode: a name or a symbol in the column.
    expect(isCurrencyCode("Dollars")).toBe(false);
    expect(isCurrencyCode("$")).toBe(false);
    expect(isCurrencyCode(null)).toBe(false);
  });
});

describe("convert refuses rather than guessing", () => {
  const fresh = (over = {}) => ({
    from: "EUR",
    to: "USD",
    rate: 1.08,
    asOf: "2026-09-05T11:00:00Z",
    ...over,
  });

  test("same currency needs no rate", () => {
    // The case the USD-only app takes every time.
    expect(convert(money(100, "USD"), "USD", null, NOW)).toEqual(money(100, "USD"));
  });

  test("no rate is a refusal", () => {
    expect(convert(money(100, "EUR"), "USD", null, NOW)).toBeNull();
  });

  test("a rate for the wrong pair is a refusal", () => {
    // Otherwise a silently wrong conversion.
    expect(convert(money(100, "EUR"), "USD", fresh({ from: "GBP" }), NOW)).toBeNull();
  });

  test("a stale rate is a refusal", () => {
    // An FX rate from last month applied to today's balance is a confident
    // wrong figure.
    expect(convert(money(100, "EUR"), "USD", fresh({ asOf: "2026-07-01T00:00:00Z" }), NOW)).toBeNull();
  });

  test("a rate with no as-of is a refusal", () => {
    expect(convert(money(100, "EUR"), "USD", fresh({ asOf: null }), NOW)).toBeNull();
  });

  test("a non-positive rate is a refusal", () => {
    expect(convert(money(100, "EUR"), "USD", fresh({ rate: 0 }), NOW)).toBeNull();
    expect(convert(money(100, "EUR"), "USD", fresh({ rate: NaN }), NOW)).toBeNull();
  });

  test("NEGATIVE CONTROL: a good rate DOES convert", () => {
    // Without this, `convert = () => null` passes everything above except the
    // same-currency case.
    const out = convert(money(100, "EUR"), "USD", fresh(), NOW);
    expect(out).not.toBeNull();
    expect(out!.currency).toBe("USD");
    expect(out!.amount).toBeCloseTo(108, 6);
  });
});

describe("sumMoney", () => {
  test("same currency sums", () => {
    expect(sumMoney([money(10, "USD"), money(5, "USD")])).toEqual(money(15, "USD"));
  });

  test("mixed currencies refuse", () => {
    // 100 USD + 100 EUR is 200 of nothing, and there is no way to render that
    // which does not read as a total.
    expect(sumMoney([money(100, "USD"), money(100, "EUR")])).toBeNull();
  });

  test("an empty list is null, not zero dollars", () => {
    // Returning `{ amount: 0, currency: "USD" }` would be the USD assumption
    // sneaking back in through the empty case.
    expect(sumMoney([])).toBeNull();
  });

  test("a non-finite amount refuses", () => {
    expect(sumMoney([money(10, "USD"), money(NaN, "USD")])).toBeNull();
  });
});

// Rule 33's "preserve source precision in CALCULATIONS" is not enforceable by
// a type. It is enforceable by making the rounding function say out loud that
// it is a display concern, and by checking that no engine calls it.
describe("the engines do not round", () => {
  test("no non-rounding module rounds", () => {
    const offenders: string[] = [];
    for (const file of NON_ROUNDING_MODULES) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      if (/\broundForDisplay\s*\(/.test(code)) offenders.push(`${file} calls roundForDisplay`);
      if (/\.toFixed\s*\(/.test(code)) offenders.push(`${file} calls toFixed`);
      // `Math.round` on a MONEY figure. `Math.round` on a count of days or
      // periods is arithmetic, not rounding a price, so the needle is the
      // scaled form — `Math.round(x * 100) / 100`.
      if (/Math\.round\([^)]*\*\s*1?0*\)\s*\/\s*10*/.test(code)) {
        offenders.push(`${file} scales-and-rounds a figure`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("NEGATIVE CONTROL: those needles match the shapes they forbid", () => {
    const bad = `const x = Math.round(v * 100) / 100; const y = v.toFixed(2);`;
    expect(bad).toMatch(/\.toFixed\s*\(/);
    expect(bad).toMatch(/Math\.round\([^)]*\*\s*1?0*\)\s*\/\s*10*/);
  });

  test("NEGATIVE CONTROL: they spare an honest period count", () => {
    // `objectiveMath.ts` legitimately rounds a number of contribution
    // periods, which is a count and not a figure.
    const fine = `const n = Math.max(0, Math.round(years * periodsPerYear));`;
    expect(fine).not.toMatch(/Math\.round\([^)]*\*\s*1?0*\)\s*\/\s*10*/);
  });

  test("every listed module exists", () => {
    // A guard over files that have been renamed away guards nothing — which
    // nearly happened in Phase 4 when `familyPolicy.ts` moved.
    for (const f of NON_ROUNDING_MODULES) expect(readFileSync(f, "utf8").length).toBeGreaterThan(0);
  });
});

describe("the presentation currency has one home", () => {
  test("it is USD today, and it is a named constant", () => {
    expect(PRESENTATION_CURRENCY).toBe("USD");
  });

  test("roundForDisplay rounds half UP at the boundary a person checks", () => {
    // The obvious implementation — `Math.round(v * 100) / 100` — gets this
    // wrong: 1.005 * 100 is 100.49999999999999 in binary floating point, so it
    // rounds DOWN to 1.00 and somebody reports a penny missing. My first
    // version had that bug and this assertion is what found it.
    expect(roundForDisplay(1.005, 2)).toBeCloseTo(1.01, 10);
    expect(roundForDisplay(2.675, 2)).toBeCloseTo(2.68, 10);
  });

  test("NEGATIVE CONTROL: the obvious implementation would fail that", () => {
    // Pinning WHY the implementation is not the obvious one, so a future
    // simplification has to argue with this rather than just look tidier.
    const naive = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
    expect(naive(1.005, 2)).not.toBeCloseTo(1.01, 10);
  });

  test("it works at crypto scale", () => {
    expect(roundForDisplay(0.000034125, 8)).toBeCloseTo(0.00003413, 12);
  });

  test("non-finite input passes through", () => {
    expect(Number.isNaN(roundForDisplay(NaN, 2))).toBe(true);
  });
});
