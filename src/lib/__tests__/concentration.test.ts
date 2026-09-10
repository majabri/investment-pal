// Concentration denominators (P0-05 / RISK-001).
//
// The defect these guard against is not an arithmetic error — every one of the
// four call sites divided correctly. It is that four correct divisions by four
// different denominators all rendered as "%", so a 30% cap meant three
// different position sizes depending on which screen you were reading.
import { describe, expect, test } from "bun:test";
import { accountTotals } from "@/lib/accountTotals";
import {
  DENOMINATOR_DEFINITION,
  DENOMINATOR_HEADING,
  DENOMINATOR_KEYS,
  DENOMINATOR_LABEL,
  POLICY_DENOMINATOR,
  UNKNOWN_PCT,
  denominatorState,
  denominators,
  labelledPct,
  marginUtilisationOf,
  weightOf,
  weights,
} from "@/lib/concentration";

// Synthetic throughout (ADR-APP-012 rules 23-25). Round numbers chosen so the
// three denominators are visibly different from one another:
//   positions 80,000 · cash 20,000 · debit 30,000
//   → invested 80,000 · gross 100,000 · net equity 70,000
const positions = [{ quantity: 800, cost_basis: 50, current_price: 100 }];
const balance = { cash: 20_000, margin_used: 30_000 };

describe("denominators", () => {
  test("the three denominators are three different numbers", () => {
    const d = denominators(accountTotals(positions, balance));
    expect(d.investedAssets).toBe(80_000);
    expect(d.grossAssets).toBe(100_000);
    expect(d.netEquity).toBe(70_000);
    // The whole point: they are not interchangeable.
    expect(new Set([d.investedAssets, d.grossAssets, d.netEquity]).size).toBe(3);
  });

  test("the same position is three different percentages", () => {
    const d = denominators(accountTotals(positions, balance));
    const w = weights(24_000, d);
    expect(w.investedAssets).toBeCloseTo(0.3, 10); // exactly at a 30% cap
    expect(w.grossAssets).toBeCloseTo(0.24, 10); // comfortably under it
    expect(w.netEquity).toBeCloseTo(24_000 / 70_000, 10); // over it
    // 34.3% vs 30.0% vs 24.0% — a breach, a boundary and a pass, same position.
    expect(w.netEquity!).toBeGreaterThan(0.3);
    expect(w.grossAssets!).toBeLessThan(0.3);
  });

  test("unknown cash makes net equity and gross unknown, not zero", () => {
    const d = denominators(accountTotals(positions, { cash: null, margin_used: 30_000 }));
    expect(d.grossAssets).toBeNull();
    expect(d.netEquity).toBeNull();
    // Invested assets is still known: an empty position list is a fact.
    expect(d.investedAssets).toBe(80_000);
  });

  test("unknown debit makes net equity unknown but leaves gross known", () => {
    const d = denominators(accountTotals(positions, { cash: 20_000, margin_used: null }));
    expect(d.grossAssets).toBe(100_000);
    expect(d.netEquity).toBeNull();
  });
});

describe("denominatorState", () => {
  test("distinguishes known, unknown and zero", () => {
    const known = denominators(accountTotals(positions, balance));
    expect(denominatorState(known, "netEquity")).toBe("known");

    const unknown = denominators(accountTotals(positions, { cash: null, margin_used: null }));
    expect(denominatorState(unknown, "netEquity")).toBe("unknown");
    expect(denominatorState(unknown, "grossAssets")).toBe("unknown");

    const empty = denominators(accountTotals([], { cash: 0, margin_used: 0 }));
    expect(denominatorState(empty, "investedAssets")).toBe("zero");
    expect(denominatorState(empty, "grossAssets")).toBe("zero");
  });

  test("a fully levered account with zero equity is zero, not unknown", () => {
    // cash 0 + positions 80,000 − debit 80,000 = 0. Known, and undividable.
    const d = denominators(accountTotals(positions, { cash: 0, margin_used: 80_000 }));
    expect(d.netEquity).toBe(0);
    expect(denominatorState(d, "netEquity")).toBe("zero");
    expect(weightOf(24_000, d, "netEquity")).toBeNull();
  });
});

describe("weightOf", () => {
  test("null for an unknown denominator — never 0%", () => {
    const d = denominators(accountTotals(positions, { cash: null, margin_used: null }));
    expect(weightOf(24_000, d, "netEquity")).toBeNull();
    expect(weightOf(24_000, d, "grossAssets")).toBeNull();
  });

  test("null for a zero denominator — never Infinity", () => {
    const d = denominators(accountTotals([], { cash: 0, margin_used: 0 }));
    const w = weightOf(24_000, d, "investedAssets");
    expect(w).toBeNull();
    expect(Number.isFinite(w as number)).toBe(false);
  });

  test("null for a negative denominator", () => {
    // Debit larger than the assets: net equity is below zero. A negative
    // denominator flips the sign of every weight, so a 24% position would
    // print as −240%. Undefined is the honest answer.
    const d = denominators(accountTotals(positions, { cash: 0, margin_used: 90_000 }));
    expect(d.netEquity).toBe(-10_000);
    expect(weightOf(24_000, d, "netEquity")).toBeNull();
  });

  test("null for a non-finite position value", () => {
    const d = denominators(accountTotals(positions, balance));
    expect(weightOf(Number.NaN, d, "netEquity")).toBeNull();
    expect(weightOf(Number.POSITIVE_INFINITY, d, "netEquity")).toBeNull();
  });

  test("a zero-value position is 0%, not unknown", () => {
    // The one case where 0% is the truth: we know the denominator and we know
    // the position is worth nothing.
    const d = denominators(accountTotals(positions, balance));
    expect(weightOf(0, d, "netEquity")).toBe(0);
  });
});

describe("labelledPct", () => {
  test("every percentage states its denominator", () => {
    const d = denominators(accountTotals(positions, balance));
    expect(labelledPct(weightOf(24_000, d, "investedAssets"), "investedAssets")).toBe(
      "30.0% of invested assets",
    );
    expect(labelledPct(weightOf(24_000, d, "grossAssets"), "grossAssets")).toBe(
      "24.0% of gross assets",
    );
  });

  test("unknown renders the em-dash, not 0%", () => {
    expect(labelledPct(null, "netEquity")).toBe(`${UNKNOWN_PCT} of net equity`);
    expect(labelledPct(undefined, "netEquity")).toBe(`${UNKNOWN_PCT} of net equity`);
    expect(labelledPct(Number.NaN, "netEquity")).toBe(`${UNKNOWN_PCT} of net equity`);
    for (const key of DENOMINATOR_KEYS) expect(labelledPct(null, key)).not.toContain("0.0%");
  });

  test("respects the decimal option", () => {
    expect(labelledPct(0.3421, "netEquity", { decimals: 2 })).toBe("34.21% of net equity");
  });

  test("the unknown marker is caller-chosen — em-dash on screen, words in a prompt", () => {
    expect(labelledPct(null, "grossAssets", { unknown: "NOT KNOWN" })).toBe(
      "NOT KNOWN of gross assets",
    );
  });
});

describe("labels", () => {
  test("every denominator has a label, a heading and a definition", () => {
    for (const key of DENOMINATOR_KEYS) {
      expect(DENOMINATOR_LABEL[key].length).toBeGreaterThan(0);
      expect(DENOMINATOR_HEADING[key]).toContain("%");
      expect(DENOMINATOR_DEFINITION[key].length).toBeGreaterThan(20);
    }
  });

  test("no two denominators share a label", () => {
    const labels = DENOMINATOR_KEYS.map((k) => DENOMINATOR_LABEL[k]);
    expect(new Set(labels).size).toBe(labels.length);
    const headings = DENOMINATOR_KEYS.map((k) => DENOMINATOR_HEADING[k]);
    expect(new Set(headings).size).toBe(headings.length);
  });

  test("no label is the bare word 'account' — that is the ambiguity being removed", () => {
    for (const key of DENOMINATOR_KEYS) {
      expect(DENOMINATOR_LABEL[key]).not.toBe("acct");
      expect(DENOMINATOR_LABEL[key]).not.toBe("account");
    }
  });
});

describe("POLICY_DENOMINATOR", () => {
  test("records what main enforces today, not a new choice", () => {
    // `index.tsx` divides a position's value by the total account value and
    // compares that to `position_cap_pct`. Changing this constant changes what
    // the cap means and is money-adjacent (OD-001) — it needs the owner, and an ADR.
    expect(POLICY_DENOMINATOR).toBe("netEquity");
  });

  test("is one of the three, so a policy check can always be labelled", () => {
    expect(DENOMINATOR_KEYS).toContain(POLICY_DENOMINATOR);
    expect(DENOMINATOR_LABEL[POLICY_DENOMINATOR]).toBe("net equity");
  });
});

describe("marginUtilisationOf", () => {
  test("the two live definitions give different numbers", () => {
    const t = accountTotals(positions, balance);
    const d = denominators(t);
    const againstNet = marginUtilisationOf(t.marginDebit, d, "netEquity");
    const againstGross = marginUtilisationOf(t.marginDebit, d, "grossAssets");
    expect(againstNet).toBeCloseTo(30_000 / 70_000, 10); // 42.9% — the dashboard cap
    expect(againstGross).toBeCloseTo(0.3, 10); // 30.0% — accountTotals
    expect(againstNet).not.toBeCloseTo(againstGross as number, 3);
    // And the gross one is what `accountTotals` already reports, unchanged.
    expect(t.marginUtilisation).toBeCloseTo(againstGross as number, 10);
  });

  test("unknown debit is unknown utilisation, not zero", () => {
    const t = accountTotals(positions, { cash: 20_000, margin_used: null });
    expect(marginUtilisationOf(t.marginDebit, denominators(t), "grossAssets")).toBeNull();
  });

  test("a stated no-margin account is 0% utilised, which is a fact", () => {
    const t = accountTotals(positions, {
      cash: 20_000,
      margin_used: null,
      margin_enabled: false,
    });
    expect(t.marginDebit).toBe(0);
    expect(marginUtilisationOf(t.marginDebit, denominators(t), "grossAssets")).toBe(0);
  });
});
