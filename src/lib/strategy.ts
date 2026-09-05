// Strategy rules — the approved universe and the rules that go with it.
//
// Rule 16: "the accounting layer supports long-term, swing, income, ETF,
// retirement, education, crypto, multi-asset. Strategies sit on top; they never
// redefine the financial model." Rule 21: a strategy rule is not a user risk
// policy and not a system safety rule.
//
// What this replaces: `FAMILY_POLICY.core / .supporting / .preferredFuture /
// .speculative` — 28 tickers and a 5% cap, compiled into `src/lib/data/`. They
// drove a "% in approved names" figure on /kids and an "Approved universe"
// paragraph in the committee prompt, with nothing anywhere saying WHOSE
// approval it was. A second user of this app inherited the list and could only
// change it by changing the source (rule 37).
//
// Pure: no React and no Supabase client. The accounting engine must not import
// this module, and a source guard in `strategy.test.ts` asserts it does not —
// that assertion is what rule 16 actually means in a codebase.
import type { PolicyClass } from "./policy";

export const STRATEGY_BUCKETS = [
  "core",
  "supporting",
  "preferred_future",
  "speculative",
] as const;
export type StrategyBucket = (typeof STRATEGY_BUCKETS)[number];

export const BUCKET_LABEL: Record<StrategyBucket, string> = {
  core: "Core (permanent)",
  supporting: "Supporting",
  preferred_future: "Preferred future",
  speculative: "Speculative",
};

/** Every rule in this module is a strategy rule, and says so (rule 21). */
export const STRATEGY_POLICY_CLASS: PolicyClass = "strategy";

export type Strategy = {
  id: string;
  user_id: string;
  name: string;
  /** NULL = no such rule. Free text — a sentence for a committee to read. */
  parity_rule: string | null;
  /** NULL = no cap stated, which is not a cap of 0%. */
  speculative_max_pct: number | null;
  created_at: string;
  updated_at: string;
};

export type StrategySymbol = {
  id: string;
  user_id: string;
  strategy_id: string;
  symbol: string;
  bucket: string;
  created_at: string;
};

/** Structural minimum, so callers need not depend on the full row type. */
export type SymbolLike = { symbol: string; bucket: string };

/**
 * The approved symbols, or `null` when there is no approved universe at all.
 *
 * `null` rather than an empty set, and the distinction is the whole point. An
 * empty set answers "is MSFT approved?" with "no", which is a verdict. There
 * being no list answers it with "nobody has said", which is the truth for a
 * user who has not configured a strategy (rule 13).
 */
export function approvedSymbols(symbols: SymbolLike[]): ReadonlySet<string> | null {
  if (symbols.length === 0) return null;
  return new Set(symbols.map((s) => s.symbol));
}

/**
 * Symbols grouped by bucket, in the declared order, skipping empty buckets.
 *
 * A bucket outside the vocabulary is dropped rather than shown under a guessed
 * heading: it can only arrive from a row written before a value was retired or
 * from a hand edit, and inventing a heading for it would be the "everything
 * else is Primary" mistake again.
 */
export function byBucket(symbols: SymbolLike[]): [StrategyBucket, string[]][] {
  return STRATEGY_BUCKETS.map(
    (b) =>
      [b, symbols.filter((s) => s.bucket === b).map((s) => s.symbol)] as [StrategyBucket, string[]],
  ).filter(([, list]) => list.length > 0);
}

export type Valued = { symbol: string; value: number };

/**
 * The share of market value held in approved names, or `null` when it cannot be
 * stated.
 *
 * Three distinct reasons it may be null, and none of them is 0%:
 *
 *   * there is no approved universe, so "inside it" has no meaning;
 *   * the account holds nothing, so there is no denominator.
 *
 * The version this replaces divided by `Math.max(1, mv)`, which turned an empty
 * account into a 0% figure and — once the universe became configurable — would
 * have reported "0% in approved names" to a user who simply had not set one.
 * That is a failing grade issued against a standard nobody wrote.
 */
export function approvedShare(
  holdings: Valued[],
  approved: ReadonlySet<string> | null,
): number | null {
  if (approved === null) return null;
  const total = holdings.reduce((s, h) => s + h.value, 0);
  if (!(total > 0)) return null;
  const inside = holdings.filter((h) => approved.has(h.symbol)).reduce((s, h) => s + h.value, 0);
  return inside / total;
}
