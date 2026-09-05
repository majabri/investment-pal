// Objective arithmetic, ported from the local OS.
//
// This file used to be "Family Investment OS — Policy v1.0", a single object
// holding one household's entire configuration. Every part of it has moved to
// data, in three PRs, and the file is now just the two functions:
//
//   * WHO — a `children` array of three names and birth dates → the
//     `household_members` table (rule 22, `src/lib/household.ts`).
//   * THE GOAL — `targetPerChild`, `familyTarget`, `targetDate` and the
//     contribution plan → per-account columns (rule 20,
//     `src/lib/accountObjective.ts`).
//   * THE STRATEGY — 28 tickers in four buckets, a 5% speculative cap, a
//     parity rule and a set of scoring weights → the `strategies` and
//     `strategy_symbols` tables (rules 16 and 21, `src/lib/strategy.ts`).
//     `scoreWeights` was read by nothing and is simply gone; a weighting
//     nobody applies is not configuration, it is a leftover.
//
// What is left is arithmetic: two parameterised functions that take a present
// value, a target, a horizon and a per-period contribution. They hold no
// household's numbers, and they are what "strategy-agnostic core" means here —
// the maths does not know whose goal it is computing (rule 16).

export function fvWithContributions(
  present: number,
  annualRate: number,
  years: number,
  perPeriod: number,
  periodsPerYear = 26,
): number {
  const n = Math.max(0, Math.round(years * periodsPerYear));
  const i = Math.pow(1 + annualRate, 1 / periodsPerYear) - 1;
  if (i === 0) return present + perPeriod * n;
  return present * Math.pow(1 + i, n) + perPeriod * ((Math.pow(1 + i, n) - 1) / i);
}

export function requiredCagrWithContributions(
  present: number,
  target: number,
  years: number,
  perPeriod: number,
): number {
  if (years <= 0 || present >= target) return 0;
  let lo = -0.5,
    hi = 1.0;
  if (fvWithContributions(present, hi, years, perPeriod) < target) return hi;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (fvWithContributions(present, mid, years, perPeriod) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}
