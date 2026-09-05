// Family Investment OS — Policy v1.0 (single source of truth, ported from the local OS)
//
// WHO the household contains is no longer here. This file used to carry a
// `children` array of three names and BIRTH DATES: personal data about minors
// in application source, in a public repository, and an assumed dependant that
// a second user of this app inherited without being told (rule 22). Membership
// is now rows in `public.household_members`, provisioned empty — see
// `src/lib/household.ts`.
//
// What remains is policy: targets, cadence and an approved universe. Those are
// still one household's numbers rather than configuration, which the rest of
// Phase 4 addresses; they are not personal data and they are not a person.
export const FAMILY_POLICY = {
  version: "1.0",
  targetPerChild: 200_000,
  targetDate: "2036-07-01",
  familyTarget: 600_000,
  contribution: { amountUsd: 100, cadenceDays: 14, anchorDate: "2026-07-30" },
  core: ["MSFT", "AMZN", "GOOGL", "V", "AVGO", "BLK", "ABT", "RY"],
  supporting: ["GLD", "SLV", "ARE", "FAMRX", "FFSFX"],
  preferredFuture: ["NVDA", "META", "COST", "LLY", "BRK.B", "CRWD", "PANW", "NFLX", "TSM", "NOW"],
  speculative: { maxPct: 5, symbols: ["CLSK"] },
  parityRule:
    "Default to keeping the three portfolios substantially identical. Only recommend different holdings if there is a compelling, evidence-based reason.",
  scoreWeights: { quality: 30, diversification: 25, progress: 20, valuation: 15, risk: 10 },
} as const;

// `ageOf` moved to `src/lib/household.ts` with the membership it belongs to,
// and now returns `number | null` — see the note there on NaN and negative ages.

export const approvedSymbols = () =>
  new Set<string>([
    ...FAMILY_POLICY.core,
    ...FAMILY_POLICY.supporting,
    ...FAMILY_POLICY.preferredFuture,
    ...FAMILY_POLICY.speculative.symbols,
  ]);

export function nextContributionDate(from = new Date()): Date {
  const anchor = new Date(FAMILY_POLICY.contribution.anchorDate + "T12:00:00");
  const ms = FAMILY_POLICY.contribution.cadenceDays * 864e5;
  if (from <= anchor) return anchor;
  const periods = Math.ceil((from.getTime() - anchor.getTime()) / ms);
  return new Date(anchor.getTime() + periods * ms);
}

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
