// Outcome grading (the Learning Engine, ADR-APP-001 migration item 3). Pure,
// deterministic. Grades a past recommendation by comparing the symbol price at
// recommendation time (price_at_rec) to the subsequent close ~1d/1w/1m later,
// direction-aware by the recommended action. MEASUREMENT ONLY — no sizing/orders.

export type Grade = "CORRECT" | "WRONG" | "NEUTRAL" | "PENDING";

export interface OutcomeResult {
  outcome_1d: number | null; // fractional return, e.g. 0.03 = +3%
  outcome_1w: number | null;
  outcome_1m: number | null;
  grade: Grade;
}

export interface Close {
  date: string; // YYYY-MM-DD
  close: number;
}

/** +1 = recommendation expects price up (BUY/ADD); -1 = expects down/avoid
 *  (SELL/TRIM/REDUCE); 0 = neutral (HOLD/WATCH/MARGIN/other). */
export function actionDirection(action: string | null, recommendation: string): 1 | -1 | 0 {
  const text = `${action ?? ""} ${recommendation}`.toUpperCase();
  if (/\b(SELL|TRIM|REDUCE)\b/.test(text)) return -1;
  if (/\b(BUY|ADD)\b/.test(text)) return 1;
  return 0;
}

/** First close on or after `targetISO`, from closes sorted ascending. */
export function closeOnOrAfter(closes: Close[], targetISO: string): number | null {
  for (const c of closes) {
    if (c.date >= targetISO) return c.close;
  }
  return null;
}

/** Add calendar days to a YYYY-MM-DD date, returning YYYY-MM-DD. */
export function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Dead-band: moves smaller than this (either way) grade NEUTRAL rather than
 *  crediting/penalising noise. */
export const GRADE_DEADBAND = 0.02; // ±2%

export function computeOutcome(params: {
  decidedOn: string;
  priceAtRec: number;
  action: string | null;
  recommendation: string;
  closes: Close[];
}): OutcomeResult {
  const { decidedOn, priceAtRec, closes } = params;
  const ret = (targetISO: string): number | null => {
    if (priceAtRec <= 0) return null;
    const c = closeOnOrAfter(closes, targetISO);
    if (c == null) return null;
    return (c - priceAtRec) / priceAtRec;
  };

  const outcome_1d = ret(addDaysISO(decidedOn, 1));
  const outcome_1w = ret(addDaysISO(decidedOn, 7));
  const outcome_1m = ret(addDaysISO(decidedOn, 30));

  // Grade on the longest *settled* horizon (1m preferred, else 1w). 1d is stored
  // for display but is too noisy to grade on.
  const horizon = outcome_1m ?? outcome_1w;
  const dir = actionDirection(params.action, params.recommendation);

  let grade: Grade;
  if (horizon == null) {
    grade = "PENDING";
  } else if (dir === 0) {
    grade = "NEUTRAL";
  } else {
    const signed = dir * horizon; // >0 means price moved the recommended way
    grade = signed > GRADE_DEADBAND ? "CORRECT" : signed < -GRADE_DEADBAND ? "WRONG" : "NEUTRAL";
  }

  return { outcome_1d, outcome_1w, outcome_1m, grade };
}
