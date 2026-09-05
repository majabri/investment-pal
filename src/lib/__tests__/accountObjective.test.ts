// Phase 4, rule 20: goals are data. Rule 15: a default may never masquerade as
// a user's preference.
//
// What this replaces: `FAMILY_POLICY.targetPerChild` (200_000),
// `.familyTarget` (600_000), `.targetDate` ("2036-07-01") and `.contribution`
// ($100 every 14 days from a fixed anchor). Those reached the screen as a
// progress bar, a required CAGR and a "Behind / On Track / Ahead" verdict, and
// reached a model inside the committee prompt as the user's own objective.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  accountObjectiveOf,
  combinedTarget,
  contributionOf,
  nextContributionDate,
  type AccountObjective,
} from "../accountObjective";

const acct = (over: Record<string, unknown> = {}) => ({
  target_value: 200_000,
  target_date: "2036-07-01",
  contribution_amount: 100,
  contribution_cadence_days: 14,
  contribution_anchor_date: "2026-07-30",
  ...over,
});

describe("accountObjectiveOf", () => {
  test("reads a complete objective", () => {
    const o = accountObjectiveOf(acct());
    expect(o.kind).toBe("set");
    if (o.kind !== "set") throw new Error("unreachable");
    expect(o.targetValue).toBe(200_000);
    expect(o.targetDate).toBe("2036-07-01");
    expect(o.contribution).toEqual({ amountUsd: 100, cadenceDays: 14, anchorDate: "2026-07-30" });
  });

  test("a missing target is unset, and names what is missing", () => {
    const o = accountObjectiveOf(acct({ target_value: null }));
    expect(o.kind).toBe("unset");
    if (o.kind !== "unset") throw new Error("unreachable");
    expect(o.missing).toEqual(["target value"]);
  });

  test("a target with no horizon is UNSET, not half-usable", () => {
    // Progress, required CAGR and the verdict all need both. Computing from
    // one plus a default for the other is the fabrication this prevents.
    const o = accountObjectiveOf(acct({ target_date: null }));
    expect(o.kind).toBe("unset");
    if (o.kind !== "unset") throw new Error("unreachable");
    expect(o.missing).toEqual(["target date"]);
  });

  test("a target of 0 is a real target, not an absence", () => {
    // Rule 13 in the other direction. Someone may genuinely record 0; only
    // NULL means nobody said.
    expect(accountObjectiveOf(acct({ target_value: 0 })).kind).toBe("set");
  });

  test("an impossible date is not a horizon", () => {
    // Postgres rejects it at the column, but this module is the contract every
    // consumer trusts, whatever route the row took to get here.
    const o = accountObjectiveOf(acct({ target_date: "2036-02-31" }));
    expect(o.kind).toBe("unset");
  });

  test("NaN and empty string are unset, not values", () => {
    expect(accountObjectiveOf(acct({ target_value: NaN })).kind).toBe("unset");
    expect(accountObjectiveOf(acct({ target_date: "" })).kind).toBe("unset");
  });
});

describe("contributionOf", () => {
  test("all three parts or none", () => {
    // An amount with no cadence cannot be scheduled; a cadence with no anchor
    // has no first date. A partial plan silently completed with a default is a
    // schedule the user never agreed to.
    expect(contributionOf(acct({ contribution_cadence_days: null }))).toBeNull();
    expect(contributionOf(acct({ contribution_anchor_date: null }))).toBeNull();
    expect(contributionOf(acct({ contribution_amount: null }))).toBeNull();
  });

  test("a cadence of zero is rejected", () => {
    // `nextContributionDate` would not terminate: the period never advances.
    expect(contributionOf(acct({ contribution_cadence_days: 0 }))).toBeNull();
    expect(contributionOf(acct({ contribution_cadence_days: -7 }))).toBeNull();
    expect(contributionOf(acct({ contribution_cadence_days: 1.5 }))).toBeNull();
  });

  test("a contribution of $0 is a stated plan", () => {
    expect(contributionOf(acct({ contribution_amount: 0 }))?.amountUsd).toBe(0);
  });

  test("no plan is null, and the objective still reads as set", () => {
    // "No plan stated" is not "a plan of $0", and it does not make the target
    // unset — an account can have a goal and no recurring deposit.
    const o = accountObjectiveOf(acct({ contribution_amount: null }));
    expect(o.kind).toBe("set");
    if (o.kind !== "set") throw new Error("unreachable");
    expect(o.contribution).toBeNull();
  });

  test("NEGATIVE CONTROL: a complete plan is not null", () => {
    // Without this every assertion above passes on `() => null`.
    expect(contributionOf(acct())).not.toBeNull();
  });
});

describe("nextContributionDate", () => {
  const plan = { amountUsd: 100, cadenceDays: 14, anchorDate: "2026-07-30" };

  test("before the anchor, the anchor is next", () => {
    expect(nextContributionDate(plan, new Date("2026-07-01T12:00:00")).toISOString().slice(0, 10)).toBe(
      "2026-07-30",
    );
  });

  test("after the anchor, the next multiple of the cadence", () => {
    expect(nextContributionDate(plan, new Date("2026-08-10T12:00:00")).toISOString().slice(0, 10)).toBe(
      "2026-08-13",
    );
  });

  test("it reads the plan, not a module constant", () => {
    // The version this replaces read `FAMILY_POLICY.contribution.anchorDate`
    // and so returned the same date for every user of the app.
    const other = { amountUsd: 500, cadenceDays: 30, anchorDate: "2027-01-15" };
    expect(nextContributionDate(other, new Date("2026-12-01T12:00:00")).toISOString().slice(0, 10)).toBe(
      "2027-01-15",
    );
  });
});

describe("combinedTarget", () => {
  const set = (v: number): AccountObjective => ({
    kind: "set",
    targetValue: v,
    targetDate: "2036-07-01",
    contribution: null,
  });
  const unset: AccountObjective = { kind: "unset", missing: ["target value"] };

  test("sums when every account has a target", () => {
    expect(combinedTarget([set(200_000), set(200_000), set(150_000)])).toBe(550_000);
  });

  test("one unset target makes the household target unavailable", () => {
    // All-or-nothing, for the reason `sumField` is: "the total of the accounts
    // that happen to have a target" is not the household's target, and there
    // is no way to render it that does not read as one.
    expect(combinedTarget([set(200_000), unset])).toBeNull();
  });

  test("no accounts is null, not zero", () => {
    // `[].reduce(..., 0)` returning 0 is how "$0.00 of a $600,000 target"
    // would reach the screen.
    expect(combinedTarget([])).toBeNull();
  });

  test("does not equal a hardcoded family total", () => {
    // `familyTarget: 600_000` happened to equal three times `targetPerChild`,
    // so the two could drift apart with nothing to notice. It is derived now.
    expect(combinedTarget([set(200_000), set(200_000)])).toBe(400_000);
  });
});

describe("no objective is compiled into the source", () => {
  const strip = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  test("familyPolicy carries no target, horizon or contribution plan", () => {
    // Comments stripped: the file's header EXPLAINS what was removed and has
    // to name the figures to do it. A guard that fires on its own explanation
    // pressures the next person to delete the explanation.
    const code = strip(readFileSync("src/lib/data/familyPolicy.ts", "utf8"));
    expect(code).not.toMatch(/targetPerChild/);
    expect(code).not.toMatch(/familyTarget/);
    expect(code).not.toMatch(/targetDate/);
    // A contribution PLAN — an object with an amount and a cadence — not the
    // word. `fvWithContributions` and `requiredCagrWithContributions` still
    // live in that file and are meant to: they are parameterised arithmetic
    // that takes a contribution, not a contribution anybody set. A guard
    // written as `/contribution/i` flagged them, which is the same too-coarse
    // mistake this suite keeps catching.
    expect(code).not.toMatch(/\bcontribution\s*:/i);
    expect(code).not.toMatch(/amountUsd|cadenceDays|anchorDate/);
    expect(code).not.toMatch(/200_000|600_000/);
  });

  test("NEGATIVE CONTROL: those patterns match the constants that were removed", () => {
    const removed = `targetPerChild: 200_000, targetDate: "2036-07-01", familyTarget: 600_000,
      contribution: { amountUsd: 100, cadenceDays: 14 },`;
    expect(removed).toMatch(/targetPerChild/);
    expect(removed).toMatch(/familyTarget/);
    expect(removed).toMatch(/targetDate/);
    expect(removed).toMatch(/\bcontribution\s*:/i);
    expect(removed).toMatch(/amountUsd|cadenceDays|anchorDate/);
    expect(removed).toMatch(/200_000|600_000/);
  });

  test("NEGATIVE CONTROL: the narrowed needle still spares the arithmetic", () => {
    // The other half of narrowing it: prove it does NOT fire on the two
    // parameterised functions that are supposed to stay.
    const kept = `export function fvWithContributions(present: number, perPeriod: number) {}`;
    expect(kept).not.toMatch(/\bcontribution\s*:/i);
    expect(kept).not.toMatch(/amountUsd|cadenceDays|anchorDate/);
  });

  test("NEGATIVE CONTROL: stripping comments does not blank the file", () => {
    const code = strip(readFileSync("src/lib/data/familyPolicy.ts", "utf8"));
    expect(code).toContain("FAMILY_POLICY");
    expect(code).toContain("approvedSymbols");
  });

  test("the kid screens do not restate a target either", () => {
    // The constants moved out of `familyPolicy.ts` once before, into the call
    // sites. This is the check that they did not.
    for (const f of [
      "src/routes/_authenticated/kids.tsx",
      "src/routes/_authenticated/kids-prompt-center.tsx",
    ]) {
      const code = strip(readFileSync(f, "utf8"));
      expect(code).not.toMatch(/200[,_]000/);
      expect(code).not.toMatch(/600[,_]000/);
      expect(code).not.toMatch(/2036-07-01/);
    }
  });
});
