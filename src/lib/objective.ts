// The objective, and whether it is set at all.
//
// `goals.target_value`, `starting_value` and `target_date` are nullable as of
// the 2026-09-05 P0 remediation: the schema used to make an unset objective
// impossible to express (NOT NULL DEFAULT 50000 / 150000 / '2027-03-31'), so a
// new user inherited a stranger's target and every screen reported progress
// towards it as fact.
//
// Rule 13: unknown is not zero. A missing target must not become $0, and a
// missing horizon must not become "today" — `new Date(null)` is the epoch, and
// a CAGR computed against 1970 is a confident, enormous, wrong number.
//
// This module is the single place that decides whether an objective is usable,
// so no screen has to re-derive it and none of them can disagree.
import { isRealCalendarDate } from "./localDate";

export type GoalLike = {
  starting_value: number | null;
  target_value: number | null;
  target_date: string | null;
  monthly_contribution?: number | null;
};

export type Objective =
  | {
      kind: "set";
      startingValue: number;
      targetValue: number;
      targetDate: string;
      monthlyContribution: number;
    }
  | { kind: "unset"; missing: string[] };

/** Field labels, in the order a user would fill them in. */
const FIELDS = [
  ["starting value", (g: GoalLike) => g.starting_value],
  ["target value", (g: GoalLike) => g.target_value],
  ["target date", (g: GoalLike) => g.target_date],
] as const;

/**
 * Reads an objective, or reports precisely which parts are missing.
 *
 * A partially-filled objective is UNSET, not partially usable: every figure
 * downstream — required CAGR, probability, progress — needs all three, so
 * computing from two of them and a default for the third is exactly the
 * fabrication this replaces.
 */
export function objectiveOf(goal: GoalLike | null | undefined): Objective {
  if (!goal) return { kind: "unset", missing: FIELDS.map(([label]) => label) };

  const missing = FIELDS.filter(([label, read]) => {
    const v = read(goal);
    // An empty date string is as unset as null; a non-finite number is not a
    // value either, however it got here.
    if (v === null || v === undefined || v === "") return true;
    if (typeof v === "number") return !Number.isFinite(v);
    // A date that is not a real calendar date is not a horizon. Postgres
    // rejects "2027-02-31" at the column, but this module is the contract
    // every consumer trusts, and "kind: set" has to mean every field is
    // usable — an unparseable date reaches yearsBetween() as Invalid Date and
    // comes back out as NaN%, which is a figure the committee would read
    // (Copilot raised this on #138).
    return label === "target date" && !isRealCalendarDate(v);
  }).map(([label]) => label);

  if (missing.length > 0) return { kind: "unset", missing };

  return {
    kind: "set",
    startingValue: Number(goal.starting_value),
    targetValue: Number(goal.target_value),
    targetDate: String(goal.target_date),
    monthlyContribution: Number(goal.monthly_contribution ?? 0),
  };
}

/** One sentence naming what still has to be set. */
export function objectiveMissingLabel(o: Objective): string | null {
  if (o.kind === "set") return null;
  const list =
    o.missing.length === 1
      ? o.missing[0]
      : `${o.missing.slice(0, -1).join(", ")} and ${o.missing[o.missing.length - 1]}`;
  return `Objective not set — ${list} ${o.missing.length === 1 ? "is" : "are"} missing.`;
}
