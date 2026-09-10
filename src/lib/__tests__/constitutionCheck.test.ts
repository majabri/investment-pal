// The governance check finally has tests (audit brief G4).
//
// It decides whether to tell the holder they have breached their own risk
// policy, and it lived inside a 150-line JSX IIFE with no coverage at all.
// Nothing below changes a comparison — these pin what `main` already does, so
// the extraction is provably behaviour-preserving and the next change to it is
// not a guess.
//
// Every figure is synthetic (ADR-APP-012 rules 23-25).
import { describe, expect, test } from "bun:test";
import { accountTotals } from "@/lib/accountTotals";
import { constitutionCheck, positionsStaleDays } from "@/lib/constitutionCheck";
import type { CheckedPolicy } from "@/lib/constitutionCheck";

// positions 80,000 · cash 20,000 · debit 30,000 → net equity 70,000
const positions = [{ quantity: 800, cost_basis: 50, current_price: 100 }];
const totalsOf = (over: { cash?: number | null; margin_used?: number | null } = {}) =>
  accountTotals(positions, { cash: 20_000, margin_used: 30_000, ...over });

const policy = (over: Partial<CheckedPolicy> = {}): CheckedPolicy => ({
  position_cap_pct: 30,
  position_cap_hard: false,
  margin_cap_pct: 25,
  caps_source: "user_set",
  ...over,
});

const held = (symbol: string, value: number) => ({ symbol, quantity: 1, price: value });

// The 30,000 debit is 42.9% of net equity, so the margin cap fires in almost
// every fixture below. These read only the POSITION lines, so a position-cap
// assertion cannot pass or fail because of the margin one.
const positionBreaches = (breaches: readonly string[]) =>
  breaches.filter((b) => !b.startsWith("Margin util") && !b.startsWith("Equity"));

describe("position cap", () => {
  test("a position over the cap is named, with its denominator", () => {
    // 24,000 / 70,000 = 34.3% of net equity, over a 30% cap.
    const v = constitutionCheck([held("NVDA", 24_000)], totalsOf(), policy());
    const lines = positionBreaches(v.breaches);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("NVDA");
    expect(lines[0]).toContain("34.3% of net equity");
    expect(lines[0]).toContain("> 30% cap");
  });

  test("a position under the cap is silent", () => {
    // 20,000 / 70,000 = 28.6%.
    expect(
      positionBreaches(constitutionCheck([held("NVDA", 20_000)], totalsOf(), policy()).breaches),
    ).toEqual([]);
  });

  test("exactly at the cap is not a breach", () => {
    // The comparison is strictly greater than. 21,000 / 70,000 = 30.0%.
    expect(
      positionBreaches(constitutionCheck([held("NVDA", 21_000)], totalsOf(), policy()).breaches),
    ).toEqual([]);
  });

  test("a HARD cap says so", () => {
    const v = constitutionCheck(
      [held("NVDA", 24_000)],
      totalsOf(),
      policy({ position_cap_hard: true }),
    );
    expect(positionBreaches(v.breaches)[0]).toContain("(HARD)");
  });

  test("every breaching position is named, not just the worst", () => {
    const v = constitutionCheck(
      [held("NVDA", 24_000), held("AVGO", 25_000), held("MSFT", 1_000)],
      totalsOf(),
      policy(),
    );
    const lines = positionBreaches(v.breaches);
    expect(lines).toHaveLength(2);
    expect(lines.join(" ")).toContain("NVDA");
    expect(lines.join(" ")).toContain("AVGO");
    expect(lines.join(" ")).not.toContain("MSFT");
  });
});

describe("whose policy it is (rule 15)", () => {
  test("app defaults carry the qualifier", () => {
    // "NVDA 34.3% > 30% cap" reads as the holder breaking their own commitment
    // whether or not they ever set the cap. The qualifier is the difference.
    const v = constitutionCheck(
      [held("NVDA", 24_000)],
      totalsOf(),
      policy({ caps_source: "default" }),
    );
    expect(positionBreaches(v.breaches)[0]).toContain("(default, not your setting)");
    expect(v.capsAreDefaults).toBe(true);
  });

  test("a policy the user saved does not", () => {
    const v = constitutionCheck([held("NVDA", 24_000)], totalsOf(), policy());
    expect(positionBreaches(v.breaches)[0]).not.toContain("default");
    expect(v.capsAreDefaults).toBe(false);
  });

  test("caps of unknown provenance are not attributed to the user either", () => {
    const v = constitutionCheck(
      [held("NVDA", 24_000)],
      totalsOf(),
      policy({ caps_source: "legacy_unknown" }),
    );
    expect(positionBreaches(v.breaches)[0]).toContain("(default, not your setting)");
  });
});

describe("margin cap", () => {
  test("over the cap is a breach, with its own denominator named", () => {
    // 30,000 / 70,000 = 42.9% of net equity, over a 25% cap.
    const v = constitutionCheck([], totalsOf(), policy());
    expect(v.breaches.some((b) => b.includes("Margin util"))).toBe(true);
    expect(v.breaches.find((b) => b.includes("Margin util"))).toContain("of net equity");
  });

  test("no margin debt means no margin breach", () => {
    const v = constitutionCheck([], totalsOf({ margin_used: 0 }), policy());
    expect(v.breaches.some((b) => b.includes("Margin util"))).toBe(false);
  });
});

describe("the Reg-T floor is not a preference (rule 21)", () => {
  test("equity under 50% is flagged as a regulatory minimum", () => {
    // 80,000 positions, 0 cash, 50,000 debit → equity 30,000 / 80,000 = 37.5%.
    const v = constitutionCheck([], totalsOf({ cash: 0, margin_used: 50_000 }), policy());
    const line = v.breaches.find((b) => b.startsWith("Equity"));
    expect(line).toBeDefined();
    expect(line!).toContain("regulatory minimum");
  });

  test("it never carries the user-policy qualifier — it is not theirs to set", () => {
    const v = constitutionCheck(
      [],
      totalsOf({ cash: 0, margin_used: 50_000 }),
      policy({ caps_source: "default" }),
    );
    const line = v.breaches.find((b) => b.startsWith("Equity"))!;
    expect(line).not.toContain("default, not your setting");
  });
});

describe("unknown means UNCHECKED, never clean", () => {
  test("an unknown cash balance makes the check unrunnable", () => {
    const v = constitutionCheck([held("NVDA", 24_000)], totalsOf({ cash: null }), policy());
    expect(v.checkable).toBe(false);
  });

  test("an unknown debit makes it unrunnable too", () => {
    expect(constitutionCheck([], totalsOf({ margin_used: null }), policy()).checkable).toBe(false);
  });

  test("no breaches under an unknown account value is NOT a pass", () => {
    // The distinction this struct exists for: a check that could not run
    // produces an empty breach list, and rendering that as "within policy" is
    // a governance check passing because it checked nothing.
    const v = constitutionCheck([held("NVDA", 24_000)], totalsOf({ cash: null }), policy());
    expect(v.breaches).toEqual([]);
    expect(v.checkable).toBe(false);
    // And the position IS 34.3% of the net equity we do not know — the check
    // is silent because it cannot run, not because the position is fine.
  });

  test("the equity floor is not fireable on unknown data, and is not silently clean", () => {
    const v = constitutionCheck([], totalsOf({ cash: null }), policy());
    expect(v.breaches.some((b) => b.startsWith("Equity"))).toBe(false);
    expect(v.checkable).toBe(false);
  });
});

describe("positionsStaleDays", () => {
  const NOW = Date.parse("2026-09-10T12:00:00Z");

  test("never imported is NULL, not zero", () => {
    // Zero would mean the positions are fresh. The line reads "never imported"
    // against null and "imported today" against 0, and that is the whole point.
    expect(positionsStaleDays([], NOW)).toBeNull();
    expect(positionsStaleDays([{ updated_at: null }], NOW)).toBeNull();
  });

  test("the NEWEST import wins, not the oldest", () => {
    const days = positionsStaleDays(
      [{ updated_at: "2026-09-01T12:00:00Z" }, { updated_at: "2026-09-09T12:00:00Z" }],
      NOW,
    );
    expect(days).toBe(1);
  });

  test("today is zero", () => {
    expect(positionsStaleDays([{ updated_at: "2026-09-10T09:00:00Z" }], NOW)).toBe(0);
  });

  test("an unparseable timestamp is unknown, not stale-forever", () => {
    expect(positionsStaleDays([{ updated_at: "not a date" }], NOW)).toBeNull();
  });
});
