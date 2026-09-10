// Target value and target return are two ways of saying one thing — until they
// aren't (GOAL-001 / GOAL-002).
//
// The requirement this exists for is a refusal: when both are entered and they
// describe different plans, the app must NOT pick one. On a $95,000 baseline
// the difference between "$150,000 by March 2027" and "12% a year" is tens of
// thousands of dollars, and choosing silently decides which the holder meant.
//
// Every figure is synthetic (ADR-APP-012 rules 23-25).
import { describe, expect, test } from "bun:test";
import {
  LINKAGE_TOLERANCE,
  PERIODS_PER_YEAR,
  canSaveVersion,
  conflictExplanation,
  goalVersionInsert,
  targetLinkage,
  versionChanges,
} from "@/lib/goalVersion";
import type { GoalVersionInput, GoalVersionRow } from "@/lib/goalVersion";
import { fvWithContributions } from "@/lib/objectiveMath";

const NOW = new Date("2026-01-01T12:00:00Z");
const IN_TWO_YEARS = "2027-12-31"; // ~2.0 years from NOW

const base: GoalVersionInput = {
  baselineType: "manual_plan",
  baselineValue: 100_000,
  targetDate: IN_TWO_YEARS,
  targetValue: null,
  targetReturnPct: null,
  contributionPlan: null,
  withdrawalPlan: null,
};

describe("targetLinkage — one field stated", () => {
  test("a target value implies a return", () => {
    const l = targetLinkage({ ...base, targetValue: 121_000 }, NOW);
    expect(l.kind).toBe("value_only");
    if (l.kind !== "value_only") throw new Error("kind");
    // 100,000 → 121,000 over ~2 years, no contributions: ~10% a year.
    expect(l.impliedReturnPct).not.toBeNull();
    expect(l.impliedReturnPct!).toBeGreaterThan(0.09);
    expect(l.impliedReturnPct!).toBeLessThan(0.11);
  });

  test("a target return implies a value", () => {
    const l = targetLinkage({ ...base, targetReturnPct: 0.1 }, NOW);
    expect(l.kind).toBe("return_only");
    if (l.kind !== "return_only") throw new Error("kind");
    expect(l.impliedTargetValue).not.toBeNull();
    expect(l.impliedTargetValue!).toBeGreaterThan(119_000);
    expect(l.impliedTargetValue!).toBeLessThan(123_000);
  });

  test("without a baseline it states the figure and implies NOTHING", () => {
    // The defect this guards: an implication computed from a baseline nobody
    // supplied, rendered in the same typeface as a real one.
    const l = targetLinkage({ ...base, baselineValue: null, targetValue: 150_000 }, NOW);
    expect(l.kind).toBe("value_only");
    if (l.kind !== "value_only") throw new Error("kind");
    expect(l.impliedReturnPct).toBeNull();
  });

  test("without a horizon it implies nothing either", () => {
    const l = targetLinkage({ ...base, targetDate: null, targetReturnPct: 0.1 }, NOW);
    expect(l.kind).toBe("return_only");
    if (l.kind !== "return_only") throw new Error("kind");
    expect(l.impliedTargetValue).toBeNull();
  });

  test("a target date in the past is no horizon at all", () => {
    const l = targetLinkage({ ...base, targetDate: "2020-01-01", targetValue: 150_000 }, NOW);
    if (l.kind !== "value_only") throw new Error("kind");
    expect(l.impliedReturnPct).toBeNull();
  });

  test("an impossible calendar date is refused, not parsed into NaN", () => {
    const l = targetLinkage({ ...base, targetDate: "2027-02-31", targetValue: 150_000 }, NOW);
    if (l.kind !== "value_only") throw new Error("kind");
    expect(l.impliedReturnPct).toBeNull();
  });
});

describe("targetLinkage — both stated", () => {
  test("consistent figures agree", () => {
    // Take the value the rate actually produces, so they cannot disagree.
    const implied = fvWithContributions(100_000, 0.1, 2.0, 0, 26);
    const l = targetLinkage({ ...base, targetValue: implied, targetReturnPct: 0.1 }, NOW);
    expect(l.kind).toBe("agree");
    expect(canSaveVersion(l)).toBe(true);
  });

  test("$150,000 and 12% on a $100,000 baseline is a CONFLICT, and is refused", () => {
    const l = targetLinkage({ ...base, targetValue: 150_000, targetReturnPct: 0.12 }, NOW);
    expect(l.kind).toBe("conflict");
    if (l.kind !== "conflict") throw new Error("kind");
    // Both readings are carried, so the holder resolves it by reading what each
    // one means rather than being told which the app preferred.
    expect(l.statedTargetValue).toBe(150_000);
    expect(l.statedReturnPct).toBe(0.12);
    expect(l.valueImpliedByReturn).toBeLessThan(130_000); // 12% gets nowhere near 150k
    expect(l.returnImpliedByValue).toBeGreaterThan(0.2); // 150k needs far more than 12%
    expect(canSaveVersion(l)).toBe(false);
  });

  test("the explanation names both readings and picks neither", () => {
    const l = targetLinkage({ ...base, targetValue: 150_000, targetReturnPct: 0.12 }, NOW);
    const text = conflictExplanation(
      l,
      (n) => `$${Math.round(n).toLocaleString("en-US")}`,
      (n) => `${(n * 100).toFixed(1)}%`,
    );
    expect(text).not.toBeNull();
    expect(text!).toContain("$150,000");
    expect(text!).toContain("12.0%");
    expect(text!).toContain("the app will not pick for you");
    // No verdict words anywhere.
    expect(text!).not.toContain("should");
    expect(text!).not.toContain("recommend");
  });

  test("a difference inside the tolerance is not a conflict", () => {
    const implied = fvWithContributions(100_000, 0.1, 2.0, 0, 26);
    const nudged = implied * (1 + LINKAGE_TOLERANCE / 2);
    expect(targetLinkage({ ...base, targetValue: nudged, targetReturnPct: 0.1 }, NOW).kind).toBe(
      "agree",
    );
  });

  test("a difference outside the tolerance is", () => {
    const implied = fvWithContributions(100_000, 0.1, 2.0, 0, 26);
    const nudged = implied * (1 + LINKAGE_TOLERANCE * 4);
    expect(targetLinkage({ ...base, targetValue: nudged, targetReturnPct: 0.1 }, NOW).kind).toBe(
      "conflict",
    );
  });

  test("both stated but no baseline is UNSET, not agreement", () => {
    // Claiming agreement here would be a claim about a plan the app cannot
    // evaluate — the worst of the three possible answers.
    const l = targetLinkage(
      { ...base, baselineValue: null, targetValue: 150_000, targetReturnPct: 0.12 },
      NOW,
    );
    expect(l.kind).toBe("unset");
    if (l.kind !== "unset") throw new Error("kind");
    expect(l.missing).toContain("baseline value");
  });
});

describe("targetLinkage — contributions and withdrawals", () => {
  test("a contribution plan lowers the return a target value needs", () => {
    const without = targetLinkage({ ...base, targetValue: 150_000 }, NOW);
    const with_ = targetLinkage(
      {
        ...base,
        targetValue: 150_000,
        contributionPlan: { amountUsd: 500, cadence: "monthly" },
      },
      NOW,
    );
    if (without.kind !== "value_only" || with_.kind !== "value_only") throw new Error("kind");
    expect(with_.impliedReturnPct!).toBeLessThan(without.impliedReturnPct!);
  });

  test("a withdrawal plan raises it", () => {
    const contributing = targetLinkage(
      {
        ...base,
        targetValue: 150_000,
        contributionPlan: { amountUsd: 500, cadence: "monthly" },
      },
      NOW,
    );
    const alsoWithdrawing = targetLinkage(
      {
        ...base,
        targetValue: 150_000,
        contributionPlan: { amountUsd: 500, cadence: "monthly" },
        withdrawalPlan: { amountUsd: 200, cadence: "monthly" },
      },
      NOW,
    );
    if (contributing.kind !== "value_only" || alsoWithdrawing.kind !== "value_only")
      throw new Error("kind");
    expect(alsoWithdrawing.impliedReturnPct!).toBeGreaterThan(contributing.impliedReturnPct!);
  });

  test("cadences are converted, not compared as raw amounts", () => {
    // $500 monthly and $500 weekly are not the same plan, and treating the
    // withdrawal's amount as if it shared the contribution's cadence would make
    // them cancel to nothing.
    const monthly = targetLinkage(
      {
        ...base,
        targetValue: 150_000,
        contributionPlan: { amountUsd: 500, cadence: "monthly" },
        withdrawalPlan: { amountUsd: 500, cadence: "weekly" },
      },
      NOW,
    );
    const same = targetLinkage(
      {
        ...base,
        targetValue: 150_000,
        contributionPlan: { amountUsd: 500, cadence: "monthly" },
        withdrawalPlan: { amountUsd: 500, cadence: "monthly" },
      },
      NOW,
    );
    if (monthly.kind !== "value_only" || same.kind !== "value_only") throw new Error("kind");
    // A weekly withdrawal is 4.33x the monthly one, so it needs a higher return.
    expect(monthly.impliedReturnPct!).toBeGreaterThan(same.impliedReturnPct!);
  });

  test("every cadence has a period count, and they are ordered", () => {
    expect(PERIODS_PER_YEAR.weekly).toBe(52);
    expect(PERIODS_PER_YEAR.biweekly).toBe(26);
    expect(PERIODS_PER_YEAR.monthly).toBe(12);
    expect(PERIODS_PER_YEAR.annual).toBe(1);
  });
});

describe("targetLinkage — nothing stated", () => {
  test("neither field is UNSET, and names what is missing", () => {
    const l = targetLinkage(base, NOW);
    expect(l.kind).toBe("unset");
    if (l.kind !== "unset") throw new Error("kind");
    expect(l.missing).toContain("target value or target return");
  });

  test("an unset version is savable — it is incomplete, not contradictory", () => {
    // The CHECK constraint refuses a row with neither target; this module's
    // refusal is only about the two of them disagreeing.
    expect(canSaveVersion(targetLinkage(base, NOW))).toBe(true);
  });
});

describe("versionChanges", () => {
  const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const v = (over: Partial<GoalVersionRow>): GoalVersionRow => ({
    id: "v",
    effective_at: "2026-01-01T00:00:00Z",
    baseline_type: "manual_plan",
    baseline_value: 100_000,
    target_date: "2027-12-31",
    target_value: 150_000,
    target_return_pct: null,
    contribution_plan: null,
    note: null,
    ...over,
  });

  test("the first version says so rather than diffing against nothing", () => {
    expect(versionChanges(null, v({}), usd)).toEqual(["first recorded version"]);
  });

  test("an unchanged save lists nothing", () => {
    expect(versionChanges(v({}), v({}), usd)).toEqual([]);
  });

  test("a moved target reads as a move, in both directions", () => {
    const out = versionChanges(v({}), v({ target_value: 120_000 }), usd);
    expect(out).toEqual(["target $150,000 → $120,000"]);
  });

  test("a moved date is named separately from a moved target", () => {
    const out = versionChanges(v({}), v({ target_value: 120_000, target_date: "2028-12-31" }), usd);
    expect(out).toHaveLength(2);
    expect(out.join(" ")).toContain("2027-12-31 → 2028-12-31");
  });

  test("a baseline that becomes unknown says so — it does not read as zero", () => {
    const out = versionChanges(v({}), v({ baseline_value: null }), usd);
    expect(out).toEqual(["baseline $100,000 → not known"]);
    expect(out.join(" ")).not.toContain("$0");
  });

  test("switching baseline kind is a change worth naming (GOAL-003)", () => {
    // A goal replanned from the broker's equity instead of a planning figure
    // is a different plan, even at the same number.
    const out = versionChanges(v({}), v({ baseline_type: "broker_equity" }), usd);
    expect(out).toEqual(["baseline kind manual_plan → broker_equity"]);
  });

  test("a contribution change is named, including to and from nothing", () => {
    const withPlan = v({ contribution_plan: { amountUsd: 500, cadence: "monthly" } });
    expect(versionChanges(v({}), withPlan, usd)).toEqual(["contribution not known → $500"]);
    expect(versionChanges(withPlan, v({}), usd)).toEqual(["contribution $500 → not known"]);
  });
});

describe("goalVersionInsert", () => {
  const row = () =>
    goalVersionInsert({
      userId: "u-1",
      goalId: "g-1",
      baselineType: "manual_plan",
      baselineValue: 100_000,
      targetDate: "2027-12-31",
      targetValue: 150_000,
      targetReturnPct: 0.12,
      contributionPlan: { amountUsd: 500, cadence: "monthly" },
      supersedesId: "v-0",
      note: "moved the date out",
    });

  test("writes every column the table needs, under the table's names", () => {
    expect(row()).toEqual({
      user_id: "u-1",
      goal_id: "g-1",
      account_id: null,
      baseline_type: "manual_plan",
      baseline_value: 100_000,
      target_date: "2027-12-31",
      target_value: 150_000,
      target_return_pct: 0.12,
      contribution_plan: { amountUsd: 500, cadence: "monthly" },
      supersedes_id: "v-0",
      note: "moved the date out",
    });
  });

  test("carries no updated_at — the table is append-only (GOAL-002)", () => {
    expect(Object.keys(row())).not.toContain("updated_at");
    expect(Object.keys(row())).not.toContain("id");
  });

  test("an unknown baseline is written as NULL, never as zero", () => {
    const r = goalVersionInsert({
      userId: "u-1",
      goalId: "g-1",
      baselineType: "manual_plan",
      baselineValue: null,
      targetDate: null,
      targetValue: 150_000,
      targetReturnPct: null,
      contributionPlan: null,
      supersedesId: null,
      note: null,
    });
    expect(r.baseline_value).toBeNull();
    expect(r.baseline_value).not.toBe(0);
    // The first version has nothing to supersede, which is null and not "".
    expect(r.supersedes_id).toBeNull();
  });

  test("the target return is a FRACTION, and the builder does not convert", () => {
    // The percentage-to-fraction conversion happens once, at the form, and a
    // second conversion here would divide it twice.
    expect(row().target_return_pct).toBe(0.12);
  });
});
