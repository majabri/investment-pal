// How a headline is scored, and against whose holdings (§15.5, CONST-006).
//
// The score used to add 30 points when a headline mentioned any of fourteen
// tickers spelled out in a regex literal in `newsServer.ts` — the owner's own
// portfolio, compiled into the generic platform. Two failures in one line:
// CONST-006 (no hard-coded owner-specific logic), and ADR-APP-012's rule that
// real portfolio data never appears in source. Every other user's news was
// ranked against one household's holdings.
//
// The held set is now an INPUT. The screen that shows the news passes the
// symbols it knows about; a screen with none passes none, and gets recency and
// magnitude only. Pure, so the arithmetic can be tested and the literal cannot
// return unnoticed — `personalData.test.ts` refuses the shape.

/** Market-moving vocabulary: first tier adds more than second. */
const TIER_1 =
  /\b(fed|fomc|cpi|inflation|crash|plunge|surge|record|war|tariff|rate (cut|hike)|recession)\b/i;
const TIER_2 =
  /\b(earnings|guidance|ai|jobs|payrolls|gdp|oil|treasury|yield|nvidia|upgrade|downgrade|merger)\b/i;

export const RECENCY_POINTS: readonly { underHours: number; points: number }[] = [
  { underHours: 1, points: 40 },
  { underHours: 3, points: 32 },
  { underHours: 6, points: 24 },
  { underHours: 12, points: 16 },
  { underHours: 24, points: 9 },
];
export const RECENCY_FLOOR = 3;
export const TIER_1_POINTS = 25;
export const TIER_2_POINTS = 12;
export const HELD_POINTS = 30;

/** Age → points. Unknown age (`null`) is treated as old, never as fresh. */
export function recencyPoints(ageHours: number | null): number {
  if (ageHours === null || !Number.isFinite(ageHours)) return RECENCY_FLOOR;
  for (const band of RECENCY_POINTS) if (ageHours < band.underHours) return band.points;
  return RECENCY_FLOOR;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A pattern matching any of the given symbols as whole words, or null when
 * there are none. Case-sensitive on purpose: tickers are uppercase, and a
 * lowercase "meta" in a headline is a word, not the company.
 *
 * Symbols are escaped, so `BRK.B` matches the ticker and not `BRKxB`.
 */
export function heldPattern(symbols: readonly string[]): RegExp | null {
  const cleaned = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (cleaned.length === 0) return null;
  return new RegExp(`(?<![A-Z0-9.])(${cleaned.map(escape).join("|")})(?![A-Z0-9])`);
}

/**
 * The relevance score for one headline.
 *
 * `held` is the caller's pattern — from `heldPattern` — or null for a caller
 * with no holdings to rank against. Null contributes nothing; it does not
 * fall back to anyone's list.
 */
export function scoreHeadline(
  title: string,
  ageHours: number | null,
  held: RegExp | null,
): number {
  return (
    recencyPoints(ageHours) +
    (TIER_1.test(title) ? TIER_1_POINTS : TIER_2.test(title) ? TIER_2_POINTS : 0) +
    (held !== null && held.test(title) ? HELD_POINTS : 0)
  );
}
