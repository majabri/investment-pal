// Which goal governs the analysis (GOAL-001, CONST-002; ADR-APP-009 Accepted
// 2026-09-18 lifted the wait the matrix recorded).
//
// The blueprint's rule: the latest valid user-saved goal version governs
// current analysis. `goals` is the CURRENT row the screen edits;
// `goal_versions` is the immutable record decisions cite. Until now every
// figure — required CAGR, probability, the brief's objective line — was
// computed from the screen, while the decision stamped the version. #228 made
// the disagreement visible; this makes the version win.
//
// Rules held here:
//   * A version governs only when it yields a SET objective. A version that
//     lacks a field the arithmetic needs does not govern, and the fallback
//     says which field.
//   * When no version governs, the `goals` row does, and the reason is
//     carried: no version recorded, the history unreadable, or the version
//     incomplete. Never silently.
//   * A contribution plan on another cadence is taken to its monthly
//     equivalent for the arithmetic, and the sentence says so. (The
//     agreement helper deliberately does NOT convert — there the cadence
//     change is the finding; here a monthly figure is what the maths needs.)
import { PERIODS_PER_YEAR, latestVersion, type GoalHistory, type GoalVersionRow } from "./goalVersion";
import { objectiveOf, type GoalLike, type Objective } from "./objective";

export type GoalSource = "version" | "goals" | "none";

export type GoverningGoal = {
  source: GoalSource;
  objective: Objective;
  /** The governing version, when one does. */
  versionId: string | null;
  effectiveAt: string | null;
  /** Why the version did not govern, when the goals row (or nothing) does. */
  fallbackReason: string | null;
  /** The plan's cadence when it was converted to monthly for the arithmetic. */
  convertedFrom: string | null;
};

/** A version in the shape `objectiveOf` reads. Cadence converted to monthly. */
export function versionAsGoalLike(v: GoalVersionRow): GoalLike & { convertedFrom: string | null } {
  const plan = v.contribution_plan;
  const monthly =
    plan === null
      ? null
      : Number.isFinite(plan.amountUsd) && plan.cadence in PERIODS_PER_YEAR
        ? (plan.amountUsd * PERIODS_PER_YEAR[plan.cadence]) / 12
        : null;
  return {
    starting_value: v.baseline_value,
    target_value: v.target_value,
    target_date: v.target_date,
    monthly_contribution: monthly,
    convertedFrom: plan !== null && plan.cadence !== "monthly" ? plan.cadence : null,
  };
}

export function governingGoal(goal: GoalLike | null | undefined, history: GoalHistory): GoverningGoal {
  const fromGoals = (fallbackReason: string): GoverningGoal => ({
    source: goal ? "goals" : "none",
    objective: objectiveOf(goal ?? null),
    versionId: null,
    effectiveAt: null,
    fallbackReason,
    convertedFrom: null,
  });

  if (history.coverage !== "known") return fromGoals("the version history could not be read");
  const version = latestVersion(history);
  if (version === null) return fromGoals("no version is recorded");

  const like = versionAsGoalLike(version);
  const objective = objectiveOf(like);
  if (objective.kind !== "set") {
    return fromGoals(`the latest version (${version.effective_at.slice(0, 10)}) lacks ${objective.missing.join(", ")}`);
  }
  return {
    source: "version",
    objective,
    versionId: version.id,
    effectiveAt: version.effective_at,
    fallbackReason: null,
    convertedFrom: like.convertedFrom,
  };
}

/** One sentence for the screen and the brief: what the figures are computed from. */
export function goalSourceSentence(g: GoverningGoal): string {
  switch (g.source) {
    case "version": {
      const base = `Figures use the goal version recorded ${g.effectiveAt!.slice(0, 10)}, not the screen.`;
      return g.convertedFrom ? `${base} Its ${g.convertedFrom} contribution is taken as a monthly equivalent.` : base;
    }
    case "goals":
      return `Figures use the goal as entered, because ${g.fallbackReason}.`;
    case "none":
      return `No goal governs: ${g.fallbackReason}, and no goal is entered.`;
  }
}
