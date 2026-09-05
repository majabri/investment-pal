// Financial helpers: formatting, CAGR, probability model.
//
// THE FORMATTERS TAKE A NUMBER, NOT `number | null` (Phase 3).
//
// They used to accept null and return "—", which is the glyph reserved for NO
// SCOPE — no account is selected. So every site that forgot the distinction
// degraded silently from "we do not know this figure" into "you have not chosen
// an account", pointing the user at the wrong fix. Review found that leak four
// separate times across Phase 1, in four different files, and the type system
// could not help because `number | null` was exactly what these took.
//
// Tightening the signature turned the whole class into compile errors. There
// were two left in application code; both are fixed in the same change. A site
// that genuinely holds a possibly-unknown figure now says so by calling
// `usdOrUnavailable` / `pctOrUnavailable` in lib/unavailable, which is the
// point — the choice is made deliberately at the call site instead of by
// forgetting.

/**
 * What a non-finite number renders as.
 *
 * The type now stops `null`, but not `NaN` — that arrives from arithmetic, and
 * arithmetic that produced NaN is a DEFECT, not an absence. Deliberately
 * neither "—" (which would re-create the leak this change removes) nor
 * "Unavailable" (which would report a bug as a missing figure, sending the user
 * to import data that will not help).
 */
import { PRESENTATION_CURRENCY } from "./currency";
import { QUANTITY_DECIMALS, classOf, displayDecimals } from "./precision";

const BROKEN = "(error)";

/**
 * Format an amount in a stated currency, to a stated number of decimals.
 *
 * The general form. `fmtUSD` below is the USD-only shorthand, kept because it
 * is called from several hundred places and changing them all at once would be
 * a diff nobody could review — but it now delegates here, so there is exactly
 * one place where a currency code turns into a symbol.
 *
 * Rule 32: a USD-only implementation is acceptable, a USD-assumed
 * ARCHITECTURE is not. Before this, `currency: "USD"` was written inline in
 * the one function every screen calls, so a GBP balance rendered with a dollar
 * sign and nothing anywhere could have noticed.
 */
export const fmtMoney = (v: number, currency: string, digits = 2) => {
  if (!Number.isFinite(v)) return BROKEN;
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

/**
 * The USD shorthand.
 *
 * Every existing call site. It is not deprecated — the app IS USD-only — but
 * a figure whose currency is known should reach `fmtMoney` instead, and a
 * figure whose currency is NOT known should not be given one silently.
 */
export const fmtUSD = (v: number, digits = 2) => fmtMoney(v, PRESENTATION_CURRENCY, digits);

/**
 * Format a unit price at the precision its instrument actually needs
 * (rule 33).
 *
 * `fmtUSD(price)` renders a crypto price of $0.00003412 as "$0.00" — not a
 * rounding error, an erasure — and makes a 10% move in a penny security
 * invisible. This picks the decimals from the instrument's class and from the
 * figure itself, and it is the function a price should go through.
 */
export const fmtPrice = (
  v: number,
  instrument: { instrument_class?: string | null; price?: number | null } = {},
  currency = PRESENTATION_CURRENCY,
) => {
  if (!Number.isFinite(v)) return BROKEN;
  const cls = classOf({
    instrument_class: instrument.instrument_class,
    price: instrument.price ?? v,
  });
  return fmtMoney(v, currency, displayDecimals(v, cls));
};

/** Format a quantity at the precision its instrument needs (rule 33). */
export const fmtQuantity = (v: number, instrument: { instrument_class?: string | null } = {}) => {
  if (!Number.isFinite(v)) return BROKEN;
  const cls = classOf({ instrument_class: instrument.instrument_class });
  // Trailing zeros on a share count are noise, so this is a maximum rather
  // than a fixed width — unlike a price, where alignment matters.
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: QUANTITY_DECIMALS[cls],
  });
};

export const fmtPct = (v: number, digits = 1) => {
  if (!Number.isFinite(v)) return BROKEN;
  return `${(v * 100).toFixed(digits)}%`;
};

export const fmtNumber = (v: number, digits = 2) => {
  if (!Number.isFinite(v)) return BROKEN;
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

export const yearsBetween = (from: Date, to: Date) => {
  const ms = to.getTime() - from.getTime();
  return ms / (1000 * 60 * 60 * 24 * 365.25);
};

export const requiredCAGR = (start: number, target: number, years: number) => {
  if (start <= 0 || years <= 0) return 0;
  return Math.pow(target / start, 1 / years) - 1;
};

export const periodicGrowth = (
  start: number,
  target: number,
  years: number,
  periodsPerYear: number,
) => {
  if (start <= 0 || years <= 0) return 0;
  const n = years * periodsPerYear;
  return Math.pow(target / start, 1 / n) - 1;
};

// Erf approximation (Abramowitz & Stegun 7.1.26)
const erf = (x: number) => {
  const sign = Math.sign(x);
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
};

const normCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

// Risk preference → assumed annualized volatility (equity portfolio proxy)
export const riskToVol = (risk: string) => {
  switch (risk) {
    case "conservative":
      return 0.12;
    case "aggressive":
      return 0.28;
    case "moderate":
    default:
      return 0.2;
  }
};

// Assumed expected return by risk preference
export const riskToExpectedReturn = (risk: string) => {
  switch (risk) {
    case "conservative":
      return 0.07;
    case "aggressive":
      return 0.14;
    case "moderate":
    default:
      return 0.1;
  }
};

/**
 * Log-normal probability that terminal value ≥ target.
 * P(V_T >= target) where log(V_T/V_0) ~ N((mu-vol^2/2)*T, vol^2*T)
 */
export const probabilityOfReachingTarget = (
  current: number,
  target: number,
  years: number,
  expectedReturn: number,
  vol: number,
) => {
  if (current <= 0 || years <= 0) return 0;
  if (current >= target) return 1;
  const mu = expectedReturn;
  const sigma = vol;
  const drift = (mu - (sigma * sigma) / 2) * years;
  const stdev = sigma * Math.sqrt(years);
  const z = (Math.log(target / current) - drift) / stdev;
  return 1 - normCdf(z);
};

export type MarginStatus = "ok" | "elevated" | "high";

export const marginStatus = (used: number, limit: number): MarginStatus => {
  if (limit <= 0) return "ok";
  const ratio = used / limit;
  if (ratio >= 0.75) return "high";
  if (ratio >= 0.4) return "elevated";
  return "ok";
};

/** Future value with monthly contributions at an annual rate. */
export const fvWithMonthlyContrib = (
  present: number,
  annualRate: number,
  years: number,
  monthly: number,
) => {
  const n = Math.max(0, Math.round(years * 12));
  const i = Math.pow(1 + annualRate, 1 / 12) - 1;
  if (i === 0) return present + monthly * n;
  return present * Math.pow(1 + i, n) + monthly * ((Math.pow(1 + i, n) - 1) / i);
};

/** Required CAGR to hit target, accounting for monthly contributions (bisection). */
export const requiredCAGRWithContrib = (
  present: number,
  target: number,
  years: number,
  monthly: number,
) => {
  if (years <= 0 || present >= target) return 0;
  if (monthly <= 0) return requiredCAGR(present, target, years);
  let lo = -0.5,
    hi = 3.0;
  if (fvWithMonthlyContrib(present, hi, years, monthly) < target) return hi;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (fvWithMonthlyContrib(present, mid, years, monthly) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
};

/** When would the target actually be reached at a given annual return? Null if >40yrs. */
export const estimatedCompletionDate = (
  present: number,
  target: number,
  annualRate: number,
  monthly: number,
): Date | null => {
  if (present >= target) return new Date();
  const i = Math.pow(1 + annualRate, 1 / 12) - 1;
  let v = present;
  for (let m = 1; m <= 480; m++) {
    v = v * (1 + i) + monthly;
    if (v >= target) {
      const d = new Date();
      d.setMonth(d.getMonth() + m);
      return d;
    }
  }
  return null;
};
