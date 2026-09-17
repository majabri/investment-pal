// Whether the goal the app analyses against is the goal on record (GOAL-001,
// CONST-002).
//
// Two tables hold the goal. `goals` is the CURRENT goal — the row every screen
// and the committee brief read. `goal_versions` is the immutable history — the
// row a decision cites. The same save writes both, and the version write is
// deliberately non-fatal, so they CAN drift: an edit made before the history
// existed, a version insert that failed, a row changed outside the app. When
// they drift, the objective on screen and the objective a decision cites are
// different goals, and nothing said so.
//
// This module says so. It does not pick a winner — that is the owner's design
// call (ADR territory: whether `goal_versions` becomes the read source). It
// makes the disagreement visible, which is the precondition for either answer.
//
// Pure. Fed by `useGoal`, which already loads both.

import type { GoalHistory, GoalVersionRow } from "@/lib/goalVersion";
import { latestVersion } from "@/lib/goalVersion";

/** The columns of `goals` that a version records. */
export type GoalOnScreen = {
  starting_value: number | null;
  target_value: number | null;
  target_date: string | null;
  monthly_contribution: number | null;
};

/**
 * The `goals` row, reduced to the columns a version records.
 *
 * Numeric columns are coerced: the generated types say `number`, and the
 * screens still wrap every read in `Number()` because a numeric column has
 * arrived as a string before. A string here would otherwise compare unequal
 * to its own value and report a divergence that is not one.
 */
export function goalOnScreen(
  goal: {
    starting_value: number | string | null;
    target_value: number | string | null;
    target_date: string | null;
    monthly_contribution: number | string | null;
  } | null,
): GoalOnScreen | null {
  if (goal === null) return null;
  const num = (v: number | string | null): number | null => (v === null ? null : Number(v));
  return {
    starting_value: num(goal.starting_value),
    target_value: num(goal.target_value),
    target_date: goal.target_date,
    monthly_contribution: num(goal.monthly_contribution),
  };
}

export type GoalAgreement =
  /** The history could not be read. Whether the goal is on record is not known. */
  | { state: "unknown" }
  /** The history is known and empty: the goal has never been versioned. */
  | { state: "unversioned" }
  /** The current goal and its latest version say the same thing. */
  | { state: "agrees"; versionId: string; effectiveAt: string }
  /** They differ. `differences` names each field, in the holder's terms. */
  | { state: "diverged"; versionId: string; effectiveAt: string; differences: string[] };

/** Money is compared to the cent; a rounding artefact is not a divergence. */
export const MONEY_TOLERANCE = 0.005;

const sameMoney = (a: number | null, b: number | null): boolean => {
  if (a === null || b === null) return a === b;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= MONEY_TOLERANCE;
};

const fmt = (v: number | null): string => (v === null ? "not set" : v.toLocaleString("en-US"));

/**
 * The differences between the current goal and a version, each named.
 *
 * Exported so the goals screen can show them beside the fields they concern.
 */
export function goalDifferences(goal: GoalOnScreen, version: GoalVersionRow): string[] {
  const out: string[] = [];
  if (!sameMoney(goal.target_value, version.target_value)) {
    out.push(`target value ${fmt(goal.target_value)} now vs ${fmt(version.target_value)} on record`);
  }
  if ((goal.target_date ?? null) !== (version.target_date ?? null)) {
    out.push(`target date ${goal.target_date ?? "not set"} now vs ${version.target_date ?? "not set"} on record`);
  }
  if (!sameMoney(goal.starting_value, version.baseline_value)) {
    out.push(`starting value ${fmt(goal.starting_value)} now vs ${fmt(version.baseline_value)} on record`);
  }
  const plan = version.contribution_plan;
  if (plan !== null && plan.cadence !== "monthly") {
    // The screen holds a MONTHLY figure. A plan on any other cadence is a
    // different plan whatever its amount, and the amount is not converted:
    // $500 weekly is not $2,000 monthly to the cent, and pretending it is
    // would hide the one thing worth saying — the cadence changed.
    out.push(`contribution ${fmt(goal.monthly_contribution)} monthly now vs ${fmt(plan.amountUsd)} ${plan.cadence} on record`);
  } else if (!sameMoney(goal.monthly_contribution, plan?.amountUsd ?? null)) {
    out.push(`monthly contribution ${fmt(goal.monthly_contribution)} now vs ${fmt(plan?.amountUsd ?? null)} on record`);
  }
  return out;
}

export function goalAgreement(goal: GoalOnScreen | null, history: GoalHistory): GoalAgreement {
  if (history.coverage !== "known") return { state: "unknown" };
  const version = latestVersion(history);
  if (version === null) return { state: "unversioned" };
  if (goal === null) {
    // A version with no current goal to compare against is a divergence of
    // its own: the record says there is a goal and the screen says there is not.
    return {
      state: "diverged",
      versionId: version.id,
      effectiveAt: version.effective_at,
      differences: ["no current goal, but a version is on record"],
    };
  }
  const differences = goalDifferences(goal, version);
  return differences.length === 0
    ? { state: "agrees", versionId: version.id, effectiveAt: version.effective_at }
    : { state: "diverged", versionId: version.id, effectiveAt: version.effective_at, differences };
}

const day = (iso: string): string => iso.slice(0, 10);

/**
 * The sentence the goals screen shows, or null when there is nothing to say.
 *
 * Null only for `agrees`: a notice on every visit is a notice nobody reads.
 */
export function goalAgreementSentence(a: GoalAgreement): string | null {
  switch (a.state) {
    case "agrees":
      return null;
    case "unknown":
      return "The goal's version history could not be read. Whether the goal shown here is the one on record is not known.";
    case "unversioned":
      return "This goal has no recorded version. Decisions taken against it cite no goal version until it is saved once.";
    case "diverged":
      return `The goal shown here differs from its latest recorded version (${day(a.effectiveAt)}): ${a.differences.join("; ")}. Decisions cite the version, not the screen.`;
  }
}

/**
 * The line the committee brief carries. Never null: the brief always states
 * the goal's provenance, because a model reasoning from a goal should know
 * whether that goal is on record.
 */
export function goalVersionLine(a: GoalAgreement): string {
  switch (a.state) {
    case "agrees":
      return `Goal version: recorded ${day(a.effectiveAt)} — matches the goal above.`;
    case "unknown":
      return "Goal version: NOT KNOWN — the version history could not be read.";
    case "unversioned":
      return "Goal version: NONE RECORDED — decisions from this review will cite no goal version.";
    case "diverged":
      return `GOAL VERSION MISMATCH — the goal above differs from its latest recorded version (${day(a.effectiveAt)}): ${a.differences.join("; ")}. Treat the recorded version as authoritative and say so if a recommendation depends on the difference.`;
  }
}
