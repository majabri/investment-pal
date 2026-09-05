// Currency (Phase 7, rule 32).
//
// "Preserve account currency, instrument currency, source currency, FX rate,
// FX as-of, base-currency value. A USD-ONLY IMPLEMENTATION IS ACCEPTABLE; A
// USD-ASSUMED ARCHITECTURE IS NOT."
//
// That distinction is the whole of this module. The app is USD-only and will
// stay that way until somebody holds something that is not — what it must stop
// doing is ASSUMING it, which today it does in one line:
//
//     v.toLocaleString("en-US", { style: "currency", currency: "USD", ... })
//
// called from every screen. A GBP balance passed through that renders with a
// dollar sign, and there is nothing anywhere that could notice.
//
// `accounts.currency` already exists and is nullable with no default (Phase
// 1c). This gives it somewhere to be read.
//
// Pure: no React, no Supabase client, no network. There is deliberately NO
// rate provider here — rule 32 asks for the architecture, and inventing a rate
// source would be worse than having none. `convert` requires a rate the caller
// supplies and refuses to guess one.
import { isDecisionGrade, freshnessOf } from "./freshness";

/**
 * An amount and what it is denominated in.
 *
 * The currency is REQUIRED. That is the fix: a bare `number` passing through
 * `fmtUSD` is how a non-USD figure acquires a dollar sign, and a type that
 * makes the currency optional would let the same thing happen with more steps.
 */
export type Money = {
  amount: number;
  /** ISO 4217, upper case. */
  currency: string;
};

export const money = (amount: number, currency: string): Money => ({
  amount,
  currency: currency.toUpperCase(),
});

/**
 * The currency to present a figure in when nothing says otherwise.
 *
 * Not a constant `"USD"` scattered through the code — one place, named for
 * what it is, so the day somebody holds a euro the search finds every
 * assumption at once.
 */
export const PRESENTATION_CURRENCY = "USD";

export type FxRate = {
  from: string;
  to: string;
  /** Units of `to` per one unit of `from`. */
  rate: number;
  /** When the rate was TRUE. Never when it was fetched. */
  asOf: string | null;
};

/**
 * Convert, or refuse.
 *
 * Four refusals, and every one of them is a case where the alternative is a
 * number that looks right:
 *
 *   * no rate for this pair — there is nothing to convert with;
 *   * the rate is for a different pair — a silently wrong conversion;
 *   * the rate is stale — an FX rate from last month applied to today's
 *     balance is a confident wrong figure, and rule 14's freshness states
 *     already exist to say so;
 *   * the rate is not a finite positive number.
 *
 * Same-currency conversion returns the input unchanged and needs no rate. That
 * is the case the USD-only app actually takes, every time.
 */
export function convert(
  from: Money,
  toCurrency: string,
  rate: FxRate | null,
  now = new Date(),
): Money | null {
  const to = toCurrency.toUpperCase();
  if (from.currency === to) return from;
  if (rate === null) return null;
  if (rate.from.toUpperCase() !== from.currency || rate.to.toUpperCase() !== to) return null;
  if (!Number.isFinite(rate.rate) || rate.rate <= 0) return null;
  // An FX rate is a delayed quote at best. `isDecisionGrade` is the same test
  // every other figure passes, rather than a second staleness rule.
  if (
    !isDecisionGrade(freshnessOf(rate.rate, { sourceType: "delayed_quote", asOf: rate.asOf }, now))
  ) {
    return null;
  }
  return { amount: from.amount * rate.rate, currency: to };
}

/**
 * Sum amounts, or refuse.
 *
 * Mixed currencies return `null` rather than a number. Adding 100 USD to 100
 * EUR produces 200 of nothing, and there is no way to render that which does
 * not read as a total — the same argument `sumField` makes about unknown
 * balances, applied to units instead of to absence.
 *
 * An empty list is `null` too: "the total of no amounts" has no currency, and
 * returning `{ amount: 0, currency: "USD" }` would be the USD assumption
 * sneaking back in through the empty case.
 */
export function sumMoney(amounts: readonly Money[]): Money | null {
  if (amounts.length === 0) return null;
  const currency = amounts[0]!.currency;
  let total = 0;
  for (const m of amounts) {
    if (m.currency !== currency) return null;
    if (!Number.isFinite(m.amount)) return null;
    total += m.amount;
  }
  return { amount: total, currency };
}

/**
 * The currency a figure from this account is denominated in, or `null`.
 *
 * `null`, not `"USD"`. `accounts.currency` has been nullable with no default
 * since Phase 1c precisely so this could be honest, and defaulting here would
 * throw that away one layer up.
 */
export function accountCurrency(account: { currency: string | null } | null): string | null {
  const c = account?.currency;
  return c && c.trim() !== "" ? c.toUpperCase() : null;
}

/** Whether a string is shaped like an ISO 4217 code. Shape only — the list of
 *  real codes is not the app's to keep, and a shape check catches the actual
 *  failure mode, which is a name or a symbol in the column. */
export function isCurrencyCode(v: string | null | undefined): boolean {
  return typeof v === "string" && /^[A-Z]{3}$/.test(v.trim().toUpperCase());
}
