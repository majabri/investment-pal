// Goal versions, and the one linkage the schema cannot enforce (GOAL-001/002).
//
// The table is `goal_versions` (migration 20260910160000). This module is the
// part a CHECK constraint cannot express: whether a version's target VALUE and
// its target RETURN describe the same plan.
//
// They are two ways of saying one thing, and the holder may think in either —
// "$150,000 by March 2027" or "12% a year". Given a baseline, a horizon and a
// contribution plan, each implies the other exactly. When both are entered and
// they disagree, the app must NOT pick one: the difference between a $150,000
// target and a 12% target on a $95,000 baseline is tens of thousands of
// dollars, and choosing silently would decide which one the holder meant.
import { fvWithContributions, requiredCagrWithContributions } from "./objectiveMath";
import { isRealCalendarDate, localIsoDate } from "./localDate";
import type { Insert } from "./dbRows";

/**
 * Which kind of starting point a version was planned from (GOAL-003).
 *
 * `broker_equity` moves every day and nobody chose it. `manual_plan` moves when
 * the holder decides it does. Planning from a blend of the two produces a
 * required return computed from a number that is neither.
 */
export type BaselineType = "broker_equity" | "manual_plan";

/** How often a contribution is made. The arithmetic needs periods, not prose. */
export type ContributionCadence = "weekly" | "biweekly" | "monthly" | "annual";

export const PERIODS_PER_YEAR: Record<ContributionCadence, number> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  annual: 1,
};

/** The `contribution_plan` / `withdrawal_plan` JSONB shape. */
export type FlowPlan = {
  amountUsd: number;
  cadence: ContributionCadence;
};

/** A version, in the shape the linkage needs. Mirrors the table's columns. */
export type GoalVersionInput = {
  baselineType: BaselineType;
  /** NULL = NOT KNOWN. Never treated as zero (rule 13). */
  baselineValue: number | null;
  targetDate: string | null;
  targetValue: number | null;
  /** A FRACTION: 0.12, never 12. */
  targetReturnPct: number | null;
  contributionPlan: FlowPlan | null;
  withdrawalPlan: FlowPlan | null;
};

/**
 * What the two target fields, together, amount to.
 *
 * `conflict` is the state the brief requires and the reason this is not a
 * derived column: it carries BOTH stated figures and BOTH implications, so the
 * holder resolves it by reading what each one actually means rather than by
 * being told which the app preferred.
 */
export type TargetLinkage =
  | { kind: "unset"; missing: string[] }
  | { kind: "value_only"; targetValue: number; impliedReturnPct: number | null }
  | { kind: "return_only"; targetReturnPct: number; impliedTargetValue: number | null }
  | { kind: "agree"; targetValue: number; targetReturnPct: number }
  | {
      kind: "conflict";
      /** What the holder typed. */
      statedTargetValue: number;
      statedReturnPct: number;
      /** What each one implies about the other, so the gap is legible. */
      valueImpliedByReturn: number;
      returnImpliedByValue: number;
    };

/**
 * Agreement tolerance, as a fraction of the target value.
 *
 * 0.5%. Loose enough that a rate rounded to two decimals in the UI does not
 * read as a contradiction; tight enough that a genuinely different plan does.
 * A tolerance of zero would flag every version the holder entered both ways.
 */
export const LINKAGE_TOLERANCE = 0.005;

/** Fractional years between today's date and a target date. Null if unusable. */
function yearsTo(targetDate: string, from: Date): number | null {
  if (!isRealCalendarDate(targetDate)) return null;
  // `localIsoDate`, not `toISOString()`. Today is today on the holder's
  // calendar; taking it from UTC would shift the horizon by a day every
  // evening west of Greenwich, which is P0-04 and was fixed this morning.
  const ms = Date.parse(`${targetDate}T00:00:00Z`) - Date.parse(`${localIsoDate(from)}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  const years = ms / (365.25 * 86_400_000);
  return years > 0 ? years : null;
}

/** Per-period contribution, net of any planned withdrawal at the same cadence. */
function perPeriodOf(plan: FlowPlan | null): { perPeriod: number; periodsPerYear: number } {
  if (!plan || !Number.isFinite(plan.amountUsd)) return { perPeriod: 0, periodsPerYear: 26 };
  return { perPeriod: plan.amountUsd, periodsPerYear: PERIODS_PER_YEAR[plan.cadence] };
}

/**
 * Reconcile a version's target value against its target return.
 *
 * `now` is injected so the linkage is testable without the clock — and it is
 * read as a LOCAL calendar date, because a horizon is a number of days on the
 * holder's calendar, not a UTC instant (P0-04).
 */
export function targetLinkage(input: GoalVersionInput, now: Date = new Date()): TargetLinkage {
  const missing: string[] = [];
  if (input.baselineValue === null || !Number.isFinite(input.baselineValue))
    missing.push("baseline value");
  if (input.targetDate === null || input.targetDate === "") missing.push("target date");
  if (input.targetValue === null && input.targetReturnPct === null)
    missing.push("target value or target return");

  // Without a baseline and a horizon neither field implies anything about the
  // other, so a stated figure is reported as itself with no implication —
  // never with an implication computed from a baseline nobody supplied.
  const years = input.targetDate ? yearsTo(input.targetDate, now) : null;
  const baseline = input.baselineValue;
  const usable = years !== null && baseline !== null && Number.isFinite(baseline);

  if (missing.length > 0 && input.targetValue === null && input.targetReturnPct === null) {
    return { kind: "unset", missing };
  }

  const { perPeriod, periodsPerYear } = perPeriodOf(input.contributionPlan);
  // A planned withdrawal is a negative contribution to the same arithmetic.
  const withdrawal = perPeriodOf(input.withdrawalPlan);
  const netPerPeriod =
    withdrawal.periodsPerYear === periodsPerYear
      ? perPeriod - Math.abs(withdrawal.perPeriod)
      : perPeriod - (Math.abs(withdrawal.perPeriod) * withdrawal.periodsPerYear) / periodsPerYear;

  const impliedValue = (rate: number): number | null => {
    if (!usable) return null;
    const v = fvWithContributions(baseline!, rate, years!, netPerPeriod, periodsPerYear);
    return Number.isFinite(v) ? v : null;
  };
  const impliedRate = (value: number): number | null => {
    if (!usable) return null;
    const r = requiredCagrWithContributions(baseline!, value, years!, netPerPeriod);
    return Number.isFinite(r) ? r : null;
  };

  if (input.targetValue !== null && input.targetReturnPct === null) {
    return {
      kind: "value_only",
      targetValue: input.targetValue,
      impliedReturnPct: impliedRate(input.targetValue),
    };
  }
  if (input.targetReturnPct !== null && input.targetValue === null) {
    return {
      kind: "return_only",
      targetReturnPct: input.targetReturnPct,
      impliedTargetValue: impliedValue(input.targetReturnPct),
    };
  }

  const value = input.targetValue!;
  const rate = input.targetReturnPct!;
  const fromRate = impliedValue(rate);
  const fromValue = impliedRate(value);
  // Both stated, but nothing to reconcile them WITH. Reporting agreement here
  // would be a claim about a plan the app cannot evaluate.
  if (fromRate === null || fromValue === null) {
    return { kind: "unset", missing: missing.length > 0 ? missing : ["baseline value"] };
  }

  const gap = Math.abs(fromRate - value) / Math.max(Math.abs(value), 1);
  if (gap <= LINKAGE_TOLERANCE) {
    return { kind: "agree", targetValue: value, targetReturnPct: rate };
  }
  return {
    kind: "conflict",
    statedTargetValue: value,
    statedReturnPct: rate,
    valueImpliedByReturn: fromRate,
    returnImpliedByValue: fromValue,
  };
}

/**
 * Whether a version may be saved.
 *
 * A conflict is not a warning to click past. Saving one would put two
 * incompatible plans in an immutable row that later decisions cite, and no
 * later reader could tell which had been meant.
 */
export function canSaveVersion(linkage: TargetLinkage): boolean {
  return linkage.kind !== "conflict";
}

/** The sentence a conflict has to say, naming both readings and neither winner. */
export function conflictExplanation(
  linkage: TargetLinkage,
  fmtUSD: (n: number) => string,
  fmtPct: (n: number) => string,
): string | null {
  if (linkage.kind !== "conflict") return null;
  return (
    `A target of ${fmtUSD(linkage.statedTargetValue)} and a target return of ` +
    `${fmtPct(linkage.statedReturnPct)} describe different plans. ` +
    `${fmtPct(linkage.statedReturnPct)} reaches ${fmtUSD(linkage.valueImpliedByReturn)}; ` +
    `${fmtUSD(linkage.statedTargetValue)} needs ${fmtPct(linkage.returnImpliedByValue)}. ` +
    `Choose which one is the goal — the app will not pick for you.`
  );
}

/**
 * A stored version, in the shape the history panel reads.
 *
 * Deliberately not the full row: `user_id`, `supersedes_id` and the JSONB plans
 * the UI does not render stay out, so a screen cannot come to depend on a
 * column by accident.
 */
export type GoalVersionRow = {
  id: string;
  effective_at: string;
  baseline_type: BaselineType;
  baseline_value: number | null;
  target_date: string | null;
  target_value: number | null;
  target_return_pct: number | null;
  contribution_plan: FlowPlan | null;
  note: string | null;
};

/**
 * Whether the version history could be READ — not how many versions exist.
 *
 * These are different facts and the app had been collapsing them. A failed
 * read returned an empty list, and an empty list renders as "no versions
 * recorded yet", which is a claim ABOUT the table: it tells the holder their
 * history is empty when the truth is that nobody knows. `useCashFlows` already
 * draws this line for flows (PERF-001); goal history now draws the same one.
 *
 * The consequence is not cosmetic. The most recent version is where the
 * holder's stated target RETURN lives — `goals` has no such column — so a
 * silent empty history seeds that field to null, and the next save writes null
 * into an append-only row. A stated 12% would be erased by a network blip, in
 * a table whose whole point is that nothing in it can be edited afterwards.
 */
export type GoalHistory =
  | { coverage: "known"; rows: GoalVersionRow[] }
  | { coverage: "unknown"; rows: readonly [] };

/** Coverage from a read's outcome. An error is UNKNOWN however plausible its cause. */
export function goalHistory(failed: boolean, rows: GoalVersionRow[]): GoalHistory {
  if (failed) return { coverage: "unknown", rows: [] };
  return { coverage: "known", rows };
}

/**
 * The most recent version, or null.
 *
 * Null under `unknown` means NOT KNOWN, and callers must not read it as "there
 * is no predecessor" — which is why `canRecordVersion` exists rather than a
 * null check at each call site.
 */
export function latestVersion(history: GoalHistory): GoalVersionRow | null {
  return history.coverage === "known" ? (history.rows[0] ?? null) : null;
}

/**
 * Whether a new version may be APPENDED.
 *
 * Not the same question as `canSaveVersion`, which asks whether the plan is
 * coherent. This asks whether the predecessor is known. Appending without it
 * would write `supersedes_id: null` — claiming to be the first version — and
 * would carry forward a target return nobody could read. Refusing to append is
 * recoverable; a wrong immutable row is not.
 */
export function canRecordVersion(history: GoalHistory): boolean {
  return history.coverage === "known";
}

/**
 * Why no version was recorded, in the holder's terms. Null when one was.
 *
 * The two failures are different and the holder is told which. A history that
 * could not be READ means the app declined to append; an insert that failed
 * means it tried and could not. Collapsing them into one apology would hide
 * that the first is a deliberate refusal.
 */
export function versionSkipReason(outcome: {
  historyKnown: boolean;
  inserted: boolean;
}): string | null {
  if (!outcome.historyKnown) {
    return (
      "Goal updated, but no version was recorded — the existing history could not be " +
      "read, and appending to a history you cannot see would lose what came before."
    );
  }
  if (!outcome.inserted) {
    return "Goal updated, but no version was recorded (goal_versions is not available yet).";
  }
  return null;
}

/** What changed between two versions, in the holder's terms. Empty = nothing. */
export function versionChanges(
  older: GoalVersionRow | null,
  newer: GoalVersionRow,
  fmtUSD: (n: number) => string,
): string[] {
  if (!older) return ["first recorded version"];
  const out: string[] = [];
  const money = (v: number | null) => (v === null ? "not known" : fmtUSD(v));
  if (older.target_value !== newer.target_value)
    out.push(`target ${money(older.target_value)} → ${money(newer.target_value)}`);
  if (older.target_date !== newer.target_date)
    out.push(`date ${older.target_date ?? "not known"} → ${newer.target_date ?? "not known"}`);
  if (older.baseline_value !== newer.baseline_value)
    out.push(`baseline ${money(older.baseline_value)} → ${money(newer.baseline_value)}`);
  if (older.baseline_type !== newer.baseline_type)
    out.push(`baseline kind ${older.baseline_type} → ${newer.baseline_type}`);
  if ((older.contribution_plan?.amountUsd ?? null) !== (newer.contribution_plan?.amountUsd ?? null))
    out.push(
      `contribution ${money(older.contribution_plan?.amountUsd ?? null)} → ${money(
        newer.contribution_plan?.amountUsd ?? null,
      )}`,
    );
  return out;
}

/**
 * The row an immutable version is written as.
 *
 * A pure function rather than an object literal in the hooks module, for two
 * reasons. It is testable — the shape of what gets written to an append-only
 * table is worth pinning, because a wrong value there can never be edited out.
 * And `promptMandate.test.ts` asserts that `useAppData.ts` only ever DECLARES
 * objective fields, never assigns them: the objective has one home per scope,
 * and a payload built in the hooks module is how a second one starts.
 */
export function goalVersionInsert(input: {
  userId: string;
  goalId: string;
  accountId?: string | null;
  baselineType: BaselineType;
  baselineValue: number | null;
  targetDate: string | null;
  targetValue: number | null;
  targetReturnPct: number | null;
  contributionPlan: FlowPlan | null;
  supersedesId: string | null;
  note: string | null;
}): Insert<"goal_versions"> {
  return {
    user_id: input.userId,
    goal_id: input.goalId,
    account_id: input.accountId ?? null,
    baseline_type: input.baselineType,
    baseline_value: input.baselineValue,
    target_date: input.targetDate,
    target_value: input.targetValue,
    target_return_pct: input.targetReturnPct,
    contribution_plan: input.contributionPlan,
    supersedes_id: input.supersedesId,
    note: input.note,
  };
}
