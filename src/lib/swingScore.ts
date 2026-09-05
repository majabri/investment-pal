// Swing Score — advisory trim signal (ADR-APP-002). Pure, deterministic functions
// over daily closes from price_history. Higher score = more extended.
// ADVISORY ONLY: this never sizes or places an order; it annotates a holding and
// informs the committee. The committee decides; the owner executes at their broker.

export type SwingBand = "none" | "trim-partial" | "trim-large" | "earnings-hold";

export interface SwingResult {
  insufficient: boolean;
  score?: number; // 0..100
  rsi?: number;
  pctAbove20?: number;
  pctAbove50?: number;
  band: SwingBand;
  suggestion: string | null; // e.g. "Consider trim 10–25%"
  earningsInDays?: number | null;
}

// Minimum daily closes needed for the full score (RSI(14) + 50-day MA).
export const SWING_MIN_CLOSES = 50;

/** Wilder's RSI over 14 periods. Needs >= 15 closes; null otherwise. */
export function rsi14(closes: number[]): number | null {
  const period = 14;
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i]! - closes[i - 1]!;
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i]! - closes[i - 1]!;
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Simple moving average of the last n closes; null if fewer than n. */
export function sma(closes: number[], n: number): number | null {
  if (closes.length < n) return null;
  let s = 0;
  for (let i = closes.length - n; i < closes.length; i++) s += closes[i]!;
  return s / n;
}

/** Percent of the latest close above its n-day SMA (can be negative). */
export function pctAboveSMA(closes: number[], n: number): number | null {
  const avg = sma(closes, n);
  if (avg == null || avg === 0) return null;
  const last = closes[closes.length - 1]!;
  return ((last - avg) / avg) * 100;
}

// A1: RSI(14) → 0–45. RSI<=50→0; 50–70→0–30 linear; 70–100→30–45 linear.
function rsiSubScore(rsi: number): number {
  if (rsi <= 50) return 0;
  if (rsi <= 70) return ((rsi - 50) / 20) * 30;
  return 30 + Math.min((rsi - 70) / 30, 1) * 15;
}

// A2/A3: distance above an MA → 0..maxPts, reaching max at capPct% above.
function maSubScore(pctAbove: number, capPct: number, maxPts: number): number {
  if (pctAbove <= 0) return 0;
  return Math.min(pctAbove / capPct, 1) * maxPts;
}

/** Trading (weekday) days from today until `dateISO` (YYYY-MM-DD); null if past.
 *  Ignores market holidays — a deliberate small approximation. */
export function tradingDaysUntil(dateISO: string, today = new Date()): number | null {
  const target = new Date(dateISO + "T00:00:00");
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (target < start) return null;
  let days = 0;
  const cur = new Date(start);
  while (cur < target) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) days++;
  }
  return days;
}

/**
 * Compute the Swing Score (ADR-APP-002).
 * @param closes daily closes, oldest → newest.
 * @param earningsInDays trading days until next earnings (null if none/unknown).
 */
export function computeSwing(closes: number[], earningsInDays: number | null = null): SwingResult {
  if (!closes || closes.length < SWING_MIN_CLOSES) {
    return { insufficient: true, band: "none", suggestion: null };
  }
  const rsi = rsi14(closes);
  const p20 = pctAboveSMA(closes, 20);
  const p50 = pctAboveSMA(closes, 50);
  if (rsi == null || p20 == null || p50 == null) {
    return { insufficient: true, band: "none", suggestion: null };
  }
  const score = Math.round(rsiSubScore(rsi) + maSubScore(p20, 10, 30) + maSubScore(p50, 20, 25));

  // A4: within 5 trading days of earnings → withhold the trim suggestion, flag it.
  const nearEarnings = earningsInDays != null && earningsInDays >= 0 && earningsInDays <= 5;
  let band: SwingBand;
  let suggestion: string | null;
  if (nearEarnings) {
    band = "earnings-hold";
    suggestion = `Earnings in ${earningsInDays}d — hold trim decision`;
  } else if (score >= 80) {
    band = "trim-large";
    suggestion = "Consider trim 25–50%";
  } else if (score >= 65) {
    band = "trim-partial";
    suggestion = "Consider trim 10–25%";
  } else {
    band = "none";
    suggestion = null;
  }

  return {
    insufficient: false,
    score,
    rsi,
    pctAbove20: p20,
    pctAbove50: p50,
    band,
    suggestion,
    earningsInDays: nearEarnings ? earningsInDays : null,
  };
}
