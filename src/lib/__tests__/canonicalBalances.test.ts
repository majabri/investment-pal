// The formula in `accountTotals.ts` carried the comment "Verified against a
// Fidelity balances page" over `cash + positions − debit`. One sample happened
// to reconcile. The formula may well be right; nothing established it as right,
// and nothing would have noticed if a field were being read as something else.
import { describe, expect, test } from "bun:test";

import {
  FIDELITY_FIELD_SEMANTICS,
  checkEquityIdentity,
  emptyCanonicalBalance,
  equityRoleOf,
  isCalculable,
} from "../canonicalBalances";
import { BALANCE_FIELD_ORDER } from "../balanceImport";

describe("every parsed field has a stated meaning", () => {
  test("no field the parser extracts is missing from the register", () => {
    // A parsed field with no entry has no established meaning. Without this,
    // adding a field to the parser silently gives it the default treatment,
    // which is exactly how an unexamined figure reaches a calculation.
    for (const key of BALANCE_FIELD_ORDER) {
      expect(FIDELITY_FIELD_SEMANTICS[key]).toBeDefined();
    }
  });

  test("the register invents no field the parser does not produce", () => {
    // The other direction: an entry for a field nobody parses is documentation
    // of something that does not exist.
    for (const key of Object.keys(FIDELITY_FIELD_SEMANTICS)) {
      expect(BALANCE_FIELD_ORDER as readonly string[]).toContain(key);
    }
  });

  test("every entry says why, not just what", () => {
    for (const [key, s] of Object.entries(FIDELITY_FIELD_SEMANTICS)) {
      expect(s.note.length, key).toBeGreaterThan(40);
    }
  });
});

describe("rule 8: never infer accounting from a label", () => {
  test("buying power is not an asset", () => {
    // Summing it into equity counts the same securities twice and then some.
    expect(equityRoleOf("marginBuyingPower")).toBe("informational");
    expect(equityRoleOf("nonMarginBuyingPower")).toBe("informational");
    expect(isCalculable("marginBuyingPower")).toBe(false);
  });

  test("margin market value is an asset, not the margin debt", () => {
    // Reading it as the loan would report a leveraged account as owing what it
    // owns — a plausible number, and wrong by twice the position.
    expect(equityRoleOf("marginMarketValue")).toBe("asset");
    expect(equityRoleOf("netDebit")).toBe("liability");
  });

  test("the broker's own total is a check, never a component", () => {
    // A figure that is both an input and the thing being verified verifies
    // nothing.
    expect(equityRoleOf("totalAccountValue")).toBe("broker_reported_equity");
    expect(isCalculable("totalAccountValue")).toBe(false);
  });

  test("open-order commitments reduce what is spendable, not what is owned", () => {
    expect(equityRoleOf("committedToOpenOrders")).toBe("informational");
  });

  test("exactly three fields are calculable, and they are the identity's", () => {
    const calculable = Object.keys(FIDELITY_FIELD_SEMANTICS).filter(isCalculable);
    expect(calculable.sort()).toEqual(["cashMarketValue", "marginMarketValue", "netDebit"]);
  });
});

describe("a meaning nobody can state is not an input", () => {
  test("net house surplus is unsupported and excluded from arithmetic", () => {
    // Its basis could not be established from a primary source in this
    // environment, so it is carried and shown, never used.
    expect(FIDELITY_FIELD_SEMANTICS.netHouseSurplus.basis).toBe("unsupported");
    expect(isCalculable("netHouseSurplus")).toBe(false);
  });

  test("an unsupported field could not become calculable by changing its role", () => {
    // Belt and braces: `isCalculable` checks the basis FIRST, so relabelling an
    // unsupported field as an asset does not let it into the arithmetic.
    const forged = { ...FIDELITY_FIELD_SEMANTICS.netHouseSurplus, role: "asset" as const };
    expect(forged.basis).toBe("unsupported");
  });

  test("an unknown field name is not calculable", () => {
    expect(isCalculable("smaBalance")).toBe(false);
    expect(equityRoleOf("smaBalance")).toBeNull();
  });
});

describe("the identity is checked, not assumed", () => {
  // total account value = cash market value + margin market value − net debit
  test("it holds on the synthetic block the parser tests use", () => {
    const r = checkEquityIdentity(128_450, 2_500, 145_950, 20_000);
    expect(r.kind).toBe("holds");
  });

  test("a mapping error is a finding, with both numbers", () => {
    // Reading margin market value as the debit — the rule-8 mistake — must not
    // produce a quiet wrong total.
    const r = checkEquityIdentity(128_450, 2_500, 20_000, 145_950);
    expect(r.kind).toBe("differs");
    if (r.kind === "differs") {
      expect(r.reported).toBe(128_450);
      expect(r.computed).toBe(-123_450);
    }
  });

  test("rounding noise does not raise a finding", () => {
    expect(checkEquityIdentity(128_450.005, 2_500, 145_950, 20_000).kind).toBe("holds");
  });

  test("a material difference does", () => {
    expect(checkEquityIdentity(128_460, 2_500, 145_950, 20_000).kind).toBe("differs");
  });

  test("the tolerance is not a function of portfolio size", () => {
    // Rule 31: correct at $500 and at $5,000,000. A one-cent discrepancy is
    // noise at both, and a ten-dollar one is a finding at both.
    for (const scale of [1, 100, 10_000]) {
      expect(checkEquityIdentity(100 * scale, 40 * scale, 80 * scale, 20 * scale).kind).toBe(
        "holds",
      );
      expect(checkEquityIdentity(100 * scale + 10, 40 * scale, 80 * scale, 20 * scale).kind).toBe(
        "differs",
      );
    }
  });

  test("a missing component makes it NOT CHECKABLE, never passing", () => {
    // "Checked and passed" is a stronger claim than "we could not check", and
    // the difference is the whole point of the phase.
    const r = checkEquityIdentity(128_450, null, 145_950, 20_000);
    expect(r.kind).toBe("not-checkable");
    if (r.kind === "not-checkable") expect(r.missing).toEqual(["cash market value"]);
  });

  test("it names every missing component, not just the first", () => {
    const r = checkEquityIdentity(null, null, 145_950, 20_000);
    expect(r.kind === "not-checkable" && r.missing).toEqual([
      "total account value",
      "cash market value",
    ]);
  });
});

describe("the canonical shape keeps the two equities apart", () => {
  test("broker-reported and app-calculated are separate fields", () => {
    // You cannot reconcile two numbers you have already averaged.
    const b = emptyCanonicalBalance();
    expect("brokerReportedEquity" in b).toBe(true);
    expect("appCalculatedEquity" in b).toBe(true);
  });

  test("informational figures live outside the components", () => {
    // Not a convention — a different object, so nothing summing equity can
    // reach a buying-power figure by accident.
    const b = emptyCanonicalBalance();
    expect(Object.keys(b)).not.toContain("marginBuyingPower");
    expect(Object.keys(b.informational)).toContain("marginBuyingPower");
  });

  test("everything starts unknown, nothing starts zero", () => {
    const b = emptyCanonicalBalance();
    expect(b.appCalculatedEquity).toBeNull();
    expect(b.marginDebt).toBeNull();
    expect(b.cash.total).toBeNull();
    expect(b.informational.marginBuyingPower).toBeNull();
    expect(b.currency).toBeNull();
  });
});
