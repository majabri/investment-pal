// GOAL-001 / CONST-002: the goal on screen and the goal on record can drift,
// and until this module nothing said when they had.
import { describe, expect, test } from "bun:test";

import {
  MONEY_TOLERANCE,
  goalAgreement,
  goalAgreementSentence,
  goalDifferences,
  goalOnScreen,
  goalVersionLine,
} from "@/lib/goalAgreement";
import type { GoalAgreement, GoalOnScreen } from "@/lib/goalAgreement";
import type { GoalHistory, GoalVersionRow } from "@/lib/goalVersion";

const goal = (over: Partial<GoalOnScreen> = {}): GoalOnScreen => ({
  starting_value: 40000,
  target_value: 100000,
  target_date: "2030-06-30",
  monthly_contribution: 500,
  ...over,
});

const version = (over: Partial<GoalVersionRow> = {}): GoalVersionRow => ({
  id: "v-2",
  effective_at: "2026-09-01T12:00:00Z",
  baseline_type: "manual_plan",
  baseline_value: 40000,
  target_date: "2030-06-30",
  target_value: 100000,
  target_return_pct: null,
  contribution_plan: { amountUsd: 500, cadence: "monthly" },
  note: null,
  ...over,
});

const known = (...rows: GoalVersionRow[]): GoalHistory => ({ coverage: "known", rows });
const UNKNOWN: GoalHistory = { coverage: "unknown", rows: [] };

describe("goalAgreement", () => {
  test("NEGATIVE CONTROL: a goal matching its latest version AGREES", () => {
    expect(goalAgreement(goal(), known(version()))).toEqual({
      state: "agrees",
      versionId: "v-2",
      effectiveAt: "2026-09-01T12:00:00Z",
    });
  });

  test("an unreadable history is UNKNOWN — not agreement, not divergence", () => {
    expect(goalAgreement(goal(), UNKNOWN)).toEqual({ state: "unknown" });
  });

  test("a known, empty history is UNVERSIONED", () => {
    expect(goalAgreement(goal(), known())).toEqual({ state: "unversioned" });
  });

  test("a changed target value DIVERGES and names the field", () => {
    const a = goalAgreement(goal({ target_value: 120000 }), known(version()));
    expect(a.state).toBe("diverged");
    if (a.state === "diverged") {
      expect(a.differences).toHaveLength(1);
      expect(a.differences[0]).toContain("target value");
      expect(a.differences[0]).toContain("120,000");
      expect(a.differences[0]).toContain("100,000");
    }
  });

  test("every differing field is named, not just the first", () => {
    const a = goalAgreement(
      goal({ target_value: 120000, target_date: "2031-01-01", monthly_contribution: 0 }),
      known(version()),
    );
    if (a.state !== "diverged") throw new Error("expected diverged");
    expect(a.differences.map((d) => d.split(" ")[0])).toEqual(["target", "target", "monthly"]);
  });

  test("it compares against the LATEST version, not an older one", () => {
    const older = version({ id: "v-1", effective_at: "2026-01-01T00:00:00Z", target_value: 80000 });
    // rows are newest first, as goalHistory returns them
    expect(goalAgreement(goal(), known(version(), older)).state).toBe("agrees");
  });

  test("a cent of rounding is not a divergence; more than a cent is", () => {
    expect(goalAgreement(goal({ target_value: 100000 + MONEY_TOLERANCE / 2 }), known(version())).state).toBe("agrees");
    expect(goalAgreement(goal({ target_value: 100000.02 }), known(version())).state).toBe("diverged");
  });

  test("null on one side and a value on the other is a divergence", () => {
    expect(goalAgreement(goal({ target_date: null }), known(version())).state).toBe("diverged");
    expect(goalAgreement(goal(), known(version({ baseline_value: null }))).state).toBe("diverged");
  });

  test("null on both sides agrees — not set is not set", () => {
    expect(
      goalAgreement(goal({ monthly_contribution: null }), known(version({ contribution_plan: null }))).state,
    ).toBe("agrees");
  });

  test("a version with no current goal is a divergence of its own", () => {
    const a = goalAgreement(null, known(version()));
    expect(a.state).toBe("diverged");
    if (a.state === "diverged") expect(a.differences[0]).toContain("no current goal");
  });
});

describe("goalDifferences", () => {
  test("NEGATIVE CONTROL: identical is empty", () => {
    expect(goalDifferences(goal(), version())).toEqual([]);
  });

  test("the contribution compares the plan's amount to the goal's monthly figure", () => {
    expect(goalDifferences(goal({ monthly_contribution: 600 }), version())[0]).toContain("monthly contribution");
  });

  test("a plan on another cadence differs even at the same amount — the cadence is the change", () => {
    const d = goalDifferences(goal(), version({ contribution_plan: { amountUsd: 500, cadence: "weekly" } }));
    expect(d).toHaveLength(1);
    expect(d[0]).toContain("weekly");
    expect(d[0]).toContain("monthly");
  });
});

describe("goalOnScreen", () => {
  test("NEGATIVE CONTROL: a numeric row passes through unchanged", () => {
    expect(goalOnScreen(goal())).toEqual(goal());
  });

  test("null is null — no goal is not a goal of zeros", () => {
    expect(goalOnScreen(null)).toBeNull();
  });

  test("a numeric column that arrived as a string is not a divergence from itself", () => {
    const row = { starting_value: "40000", target_value: "100000", target_date: "2030-06-30", monthly_contribution: "500" };
    expect(goalAgreement(goalOnScreen(row), known(version())).state).toBe("agrees");
  });

  test("a null column stays null — not set is not zero", () => {
    expect(goalOnScreen(goal({ starting_value: null }))!.starting_value).toBeNull();
  });
});

describe("goalAgreementSentence", () => {
  test("NEGATIVE CONTROL: agreement says nothing — a notice on every visit is a notice nobody reads", () => {
    expect(goalAgreementSentence({ state: "agrees", versionId: "v", effectiveAt: "2026-09-01T00:00:00Z" })).toBeNull();
  });

  test("divergence names the date and the differences, and says which one decisions cite", () => {
    const s = goalAgreementSentence({
      state: "diverged",
      versionId: "v",
      effectiveAt: "2026-09-01T00:00:00Z",
      differences: ["target value 120,000 now vs 100,000 on record"],
    })!;
    expect(s).toContain("2026-09-01");
    expect(s).toContain("120,000");
    expect(s).toContain("Decisions cite the version");
  });

  test("unversioned says decisions cite no version until saved", () => {
    expect(goalAgreementSentence({ state: "unversioned" })).toContain("no goal version");
  });
});

describe("goalVersionLine", () => {
  test("is never empty — the brief always states provenance", () => {
    const all: GoalAgreement[] = [
      { state: "agrees", versionId: "v", effectiveAt: "2026-09-01T00:00:00Z" },
      { state: "unknown" },
      { state: "unversioned" },
      { state: "diverged", versionId: "v", effectiveAt: "2026-09-01T00:00:00Z", differences: ["x"] },
    ];
    for (const a of all) {
      expect(goalVersionLine(a).length).toBeGreaterThan(10);
    }
  });

  test("a mismatch is shouted and tells the model which goal is authoritative", () => {
    const line = goalVersionLine({
      state: "diverged",
      versionId: "v",
      effectiveAt: "2026-09-01T00:00:00Z",
      differences: ["target value 120,000 now vs 100,000 on record"],
    });
    expect(line.startsWith("GOAL VERSION MISMATCH")).toBe(true);
    expect(line).toContain("recorded version as authoritative");
  });

  test("agreement is stated as a fact with its date", () => {
    expect(goalVersionLine({ state: "agrees", versionId: "v", effectiveAt: "2026-09-01T00:00:00Z" })).toBe(
      "Goal version: recorded 2026-09-01 — matches the goal above.",
    );
  });
});
