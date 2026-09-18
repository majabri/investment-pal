// Which goal governs (GOAL-001, CONST-002). The rule: the latest VALID version
// wins; otherwise the goals row, with the reason carried. Figures synthetic.
import { describe, expect, test } from "bun:test";

import type { GoalHistory, GoalVersionRow } from "../goalVersion";
import { goalSourceSentence, governingGoal, versionAsGoalLike } from "../governingGoal";

const screen = { starting_value: 60_000, target_value: 250_000, target_date: "2030-06-30", monthly_contribution: 500 };
const version = (over: Partial<GoalVersionRow> = {}): GoalVersionRow => ({
  id: "v-1",
  effective_at: "2026-09-01T12:00:00Z",
  baseline_type: "manual_plan",
  baseline_value: 70_000,
  target_date: "2031-01-31",
  target_value: 300_000,
  target_return_pct: null,
  contribution_plan: { amountUsd: 750, cadence: "monthly" },
  note: null,
  ...over,
});
const known = (...rows: GoalVersionRow[]): GoalHistory => ({ coverage: "known", rows });
const unknown: GoalHistory = { coverage: "unknown", rows: [] };

describe("governingGoal", () => {
  test("a complete latest version governs, even when the screen says otherwise", () => {
    const g = governingGoal(screen, known(version()));
    expect(g.source).toBe("version");
    expect(g.versionId).toBe("v-1");
    expect(g.objective).toEqual({ kind: "set", startingValue: 70_000, targetValue: 300_000, targetDate: "2031-01-31", monthlyContribution: 750 });
    expect(g.fallbackReason).toBeNull();
    // Negative control: the screen's figures are nowhere in the answer.
    expect(JSON.stringify(g)).not.toContain("250000");
  });

  test("it is the LATEST version that governs, not an older one", () => {
    const older = version({ id: "v-0", effective_at: "2026-08-01T12:00:00Z", target_value: 100_000 });
    const g = governingGoal(screen, known(version(), older));
    expect(g.versionId).toBe("v-1");
    expect(g.objective.kind === "set" && g.objective.targetValue).toBe(300_000);
  });

  test("an unreadable history: the goals row governs and says why — never treated as 'no version'", () => {
    const g = governingGoal(screen, unknown);
    expect(g.source).toBe("goals");
    expect(g.fallbackReason).toContain("could not be read");
    expect(g.objective.kind === "set" && g.objective.targetValue).toBe(250_000);
    expect(g.versionId).toBeNull();
  });

  test("no version recorded: the goals row governs and says so", () => {
    const g = governingGoal(screen, known());
    expect(g.source).toBe("goals");
    expect(g.fallbackReason).toBe("no version is recorded");
  });

  test("an incomplete version does not govern; the fallback names the missing field", () => {
    const g = governingGoal(screen, known(version({ target_value: null })));
    expect(g.source).toBe("goals");
    expect(g.fallbackReason).toContain("2026-09-01");
    expect(g.fallbackReason).toContain("target value");
    expect(g.objective.kind === "set" && g.objective.targetValue).toBe(250_000);
  });

  test("a NULL baseline on the version is NOT KNOWN, not zero: it does not govern", () => {
    const g = governingGoal(screen, known(version({ baseline_value: null })));
    expect(g.source).toBe("goals");
    expect(g.fallbackReason).toContain("starting value");
  });

  test("nothing anywhere: source is none, with the reason", () => {
    const g = governingGoal(null, known());
    expect(g.source).toBe("none");
    expect(g.objective.kind).toBe("unset");
    expect(goalSourceSentence(g)).toContain("No goal governs");
  });

  test("a version with no goals row still governs — the record does not need the screen", () => {
    const g = governingGoal(null, known(version()));
    expect(g.source).toBe("version");
  });
});

describe("versionAsGoalLike", () => {
  test("a weekly plan is taken to its monthly equivalent, and says which cadence it came from", () => {
    const like = versionAsGoalLike(version({ contribution_plan: { amountUsd: 120, cadence: "weekly" } }));
    expect(like.monthly_contribution).toBeCloseTo((120 * 52) / 12, 6);
    expect(like.convertedFrom).toBe("weekly");
  });

  test("a monthly plan is not 'converted'; no plan is null, not zero", () => {
    expect(versionAsGoalLike(version()).convertedFrom).toBeNull();
    const none = versionAsGoalLike(version({ contribution_plan: null }));
    expect(none.monthly_contribution).toBeNull();
    expect(none.convertedFrom).toBeNull();
  });

  test("the baseline is the starting value; the version's target and date carry over", () => {
    const like = versionAsGoalLike(version());
    expect(like.starting_value).toBe(70_000);
    expect(like.target_value).toBe(300_000);
    expect(like.target_date).toBe("2031-01-31");
  });
});

describe("goalSourceSentence", () => {
  test("names the version's date when the version governs, and the conversion when one happened", () => {
    const g = governingGoal(screen, known(version({ contribution_plan: { amountUsd: 120, cadence: "weekly" } })));
    const s = goalSourceSentence(g);
    expect(s).toContain("recorded 2026-09-01");
    expect(s).toContain("weekly contribution is taken as a monthly equivalent");
    expect(goalSourceSentence(governingGoal(screen, known(version())))).not.toContain("monthly equivalent");
  });

  test("names the fallback reason when the goals row governs", () => {
    expect(goalSourceSentence(governingGoal(screen, known()))).toBe("Figures use the goal as entered, because no version is recorded.");
  });
});
