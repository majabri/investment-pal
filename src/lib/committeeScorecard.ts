// Committee scorecard (migration item 4). Aggregates graded decisions by action
// type so the committee can read its own track record. Pure/deterministic.
// Measurement only — no new money numbers, no sizing.
import { actionDirection } from "./outcomeGrade";

export interface DecisionForScore {
  action: string | null;
  recommendation: string;
  grade: "CORRECT" | "WRONG" | "NEUTRAL" | "PENDING" | null;
  outcome_1m: number | null;
}

export interface ActionScore {
  action: string; // BUY | ADD | SELL | TRIM | HOLD | WATCH | OTHER
  graded: number; // CORRECT + WRONG
  correct: number;
  accuracy: number | null; // correct / graded
  avgOutcome1m: number | null; // mean outcome_1m over graded rows that have it
}

/** Canonical action bucket for a decision: prefer the stored action, else infer. */
function bucketOf(d: DecisionForScore): string {
  const a = (d.action ?? "").trim().toUpperCase();
  if (["BUY", "ADD", "SELL", "TRIM", "HOLD", "WATCH"].includes(a)) return a;
  const dir = actionDirection(d.action, d.recommendation);
  if (dir === 1) return "BUY";
  if (dir === -1) return "SELL";
  return "OTHER";
}

/** Aggregate graded (CORRECT/WRONG) decisions by action bucket, most-graded first. */
export function scorecardByAction(decisions: DecisionForScore[]): ActionScore[] {
  const map = new Map<string, { graded: number; correct: number; sum1m: number; n1m: number }>();
  for (const d of decisions) {
    if (d.grade !== "CORRECT" && d.grade !== "WRONG") continue;
    const b = bucketOf(d);
    const acc = map.get(b) ?? { graded: 0, correct: 0, sum1m: 0, n1m: 0 };
    acc.graded += 1;
    if (d.grade === "CORRECT") acc.correct += 1;
    if (d.outcome_1m != null) {
      acc.sum1m += d.outcome_1m;
      acc.n1m += 1;
    }
    map.set(b, acc);
  }
  return Array.from(map.entries())
    .map(([action, a]) => ({
      action,
      graded: a.graded,
      correct: a.correct,
      accuracy: a.graded ? a.correct / a.graded : null,
      avgOutcome1m: a.n1m ? a.sum1m / a.n1m : null,
    }))
    .sort((x, y) => y.graded - x.graded);
}

/** Human/prompt-ready lines, e.g. "TRIM calls: 7 graded, 5 correct (71%), avg 1m +3.2%". */
export function formatScorecardLines(scores: ActionScore[]): string[] {
  return scores.map((s) => {
    const acc = s.accuracy != null ? ` (${Math.round(s.accuracy * 100)}%)` : "";
    const avg =
      s.avgOutcome1m != null
        ? `, avg 1m ${s.avgOutcome1m >= 0 ? "+" : ""}${(s.avgOutcome1m * 100).toFixed(1)}%`
        : "";
    return `${s.action} calls: ${s.graded} graded, ${s.correct} correct${acc}${avg}`;
  });
}
