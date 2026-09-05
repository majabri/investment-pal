// Buy-back zones (ADR-APP-003). When a valuation/overbought trim is logged, show
// advisory re-entry levels below the sale price. ADVISORY ONLY — annotations, never
// orders. The owner executes. Pure/deterministic.

export interface TrimDecision {
  id: string;
  symbol: string | null;
  action: string | null;
  recommendation: string;
  price_at_rec: number | null;
  decided_on: string; // YYYY-MM-DD
}

export interface BuybackZone {
  pct: number; // -5, -10, -15
  price: number; // anchor * (1 + pct/100)
  status: "pending" | "hit";
}

export interface BuybackPlan {
  decisionId: string;
  symbol: string;
  anchor: number; // = price_at_rec (approximate — the actual broker fill may differ)
  decidedOn: string;
  zones: BuybackZone[];
  expired: boolean; // past the 30-day window
}

export const ZONE_PCTS = [-5, -10, -15] as const;
export const BUYBACK_EXPIRY_DAYS = 30;

// Signals that a trim/sell was thesis deterioration, not valuation/overbought —
// re-entry does not apply to these (ADR-APP-003 B1 invalidation).
const THESIS_BREAK =
  /\b(thesis|deteriorat\w*|broken|breakdown|downgrade|impair\w*|fraud|guidance cut|cut guidance|exit|stop[-\s]?loss|dead money|sell all|liquidate)\b/i;

/**
 * ADR-APP-003 B1 — zones attach ONLY to valuation/overbought-tagged trims, never
 * thesis-break sells. Conservative default classification (no explicit tag column
 * yet): a TRIM/REDUCE whose text shows no thesis-break signal. Full SELL is
 * excluded (likelier a thesis exit). This predicate is the one part of ADR-APP-003
 * not fixed by the ADR's numbers; it is isolated here for easy adjustment.
 */
export function isBuybackEligible(d: TrimDecision): boolean {
  const a = (d.action ?? "").toUpperCase();
  const isTrim = a === "TRIM" || a === "REDUCE" || /\btrim\b/i.test(d.recommendation);
  if (!isTrim) return false;
  if (THESIS_BREAK.test(d.recommendation)) return false;
  return true;
}

/** Compute the buy-back plan for a trim decision, or null if not eligible. */
export function computeBuyback(
  d: TrimDecision,
  currentPrice: number | null,
  today = new Date(),
): BuybackPlan | null {
  if (!d.symbol || d.price_at_rec == null || d.price_at_rec <= 0) return null;
  if (!isBuybackEligible(d)) return null;

  const decided = new Date(d.decided_on + "T00:00:00");
  const ageDays = Math.floor((today.getTime() - decided.getTime()) / 86_400_000);
  const expired = ageDays > BUYBACK_EXPIRY_DAYS;

  const anchor = d.price_at_rec;
  const zones: BuybackZone[] = ZONE_PCTS.map((pct) => {
    const price = anchor * (1 + pct / 100);
    const hit = currentPrice != null && currentPrice <= price;
    return { pct, price, status: hit ? "hit" : "pending" };
  });

  return { decisionId: d.id, symbol: d.symbol, anchor, decidedOn: d.decided_on, zones, expired };
}

/** Newest active (non-expired) plan per symbol, keyed by symbol. */
export function activeBuybackBySymbol(
  decisions: TrimDecision[],
  priceOf: (symbol: string) => number | null,
  today = new Date(),
): Map<string, BuybackPlan> {
  const out = new Map<string, BuybackPlan>();
  for (const d of decisions) {
    const plan = computeBuyback(d, d.symbol ? priceOf(d.symbol) : null, today);
    if (!plan || plan.expired) continue;
    const prev = out.get(plan.symbol);
    if (!prev || plan.decidedOn > prev.decidedOn) out.set(plan.symbol, plan);
  }
  return out;
}
