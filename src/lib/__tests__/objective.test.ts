// Rule 13 at the objective layer: unknown must stay unknown.
import { describe, expect, test } from "bun:test";

import { objectiveOf, objectiveMissingLabel, type GoalLike } from "../objective";

const full: GoalLike = {
  starting_value: 50_000,
  target_value: 250_000,
  target_date: "2030-06-30",
  monthly_contribution: 1_000,
};

describe("objectiveOf", () => {
  test("reads a complete objective", () => {
    const o = objectiveOf(full);
    expect(o.kind).toBe("set");
    expect(o.kind === "set" && o.targetValue).toBe(250_000);
    expect(o.kind === "set" && o.monthlyContribution).toBe(1_000);
  });

  test("no goal row at all is unset, and says every field is missing", () => {
    for (const g of [null, undefined]) {
      const o = objectiveOf(g);
      expect(o.kind).toBe("unset");
      expect(o.kind === "unset" && o.missing).toEqual([
        "starting value",
        "target value",
        "target date",
      ]);
    }
  });

  test("a null field is unset, not zero", () => {
    // The whole point: NULL target must never arrive downstream as 0, which
    // would report an objective of $0 as achieved.
    const o = objectiveOf({ ...full, target_value: null });
    expect(o.kind).toBe("unset");
    expect(o.kind === "unset" && o.missing).toEqual(["target value"]);
  });

  test("a partially filled objective is unset, not partially usable", () => {
    // Required CAGR, probability and progress each need all three. Computing
    // from two and a default for the third is the fabrication this prevents.
    const o = objectiveOf({ ...full, starting_value: null, target_date: null });
    expect(o.kind).toBe("unset");
    expect(o.kind === "unset" && o.missing).toEqual(["starting value", "target date"]);
  });

  test("an empty date string is as unset as null", () => {
    expect(objectiveOf({ ...full, target_date: "" }).kind).toBe("unset");
  });

  test("a non-finite number is not a value", () => {
    expect(objectiveOf({ ...full, target_value: Number.NaN }).kind).toBe("unset");
    expect(objectiveOf({ ...full, starting_value: Number.POSITIVE_INFINITY }).kind).toBe("unset");
  });

  test("a zero target is a real value, not a missing one", () => {
    // Zero is a claim the user can legitimately make. Only null is absence.
    expect(objectiveOf({ ...full, starting_value: 0 }).kind).toBe("set");
  });

  test("a missing monthly contribution reads as zero, which is its real default", () => {
    const o = objectiveOf({ ...full, monthly_contribution: null });
    expect(o.kind === "set" && o.monthlyContribution).toBe(0);
  });
});

// A date that is not a real day is not a horizon. Postgres rejects these at the
// DATE column, so this is the contract holding at the module boundary rather
// than a path reachable through the app today — but `objectiveOf` is what every
// consumer trusts, and "kind: set" has to mean every field is usable
// (Copilot, #138).
describe("a target date that is not a real day is not a horizon", () => {
  for (const bad of ["2027-02-31", "2027-02-30", "2026-02-29", "2027-04-31", "2027-13-01", "soon", "—"]) {
    test(`${bad} counts as missing`, () => {
      const o = objectiveOf({ ...full, target_date: bad });
      expect(o.kind).toBe("unset");
      expect(o.kind === "unset" && o.missing).toEqual(["target date"]);
    });
  }

  test("a leap day in a leap year is a real date and stays set", () => {
    // The check must not reject valid dates to catch the invalid ones.
    expect(objectiveOf({ ...full, target_date: "2028-02-29" }).kind).toBe("set");
  });
});

describe("objectiveMissingLabel", () => {
  test("names one missing field", () => {
    expect(objectiveMissingLabel(objectiveOf({ ...full, target_value: null }))).toBe(
      "Objective not set — target value is missing.",
    );
  });

  test("names several", () => {
    expect(objectiveMissingLabel(objectiveOf(null))).toBe(
      "Objective not set — starting value, target value and target date are missing.",
    );
  });

  test("is null when the objective is set, so callers cannot render a warning that does not apply", () => {
    expect(objectiveMissingLabel(objectiveOf(full))).toBeNull();
  });
});
