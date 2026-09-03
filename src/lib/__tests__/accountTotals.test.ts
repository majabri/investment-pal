// Stage 1. The live bug: totals blended every account together, because
// `useHoldings()` had no account filter and `useAccount()` summed cash and
// margin across all accounts.
//
// The anchor test is the real Fidelity statement — if the arithmetic does not
// reconcile to the cent against that, nothing else here matters.
import { describe, expect, test } from "bun:test";

import {
  accountTotals,
  scopedRows,
  scopeIsEmpty,
  scopeLabel,
  type AccountScope,
  type PositionLike,
} from "../accountTotals";

describe("reconciles to the Fidelity statement", () => {
  // Amir — TOD, 2026-09-03. cash 0.38 + margin market value 60,602.30
  // − net debit 6,664.33 = total account value 53,938.35.
  const positions: PositionLike[] = [
    { quantity: 100, cost_basis: 500, current_price: 606.023 }, // 60,602.30
  ];
  const balance = { cash: 0.38, margin_used: 6_664.33 };

  test("total account value matches to the cent", () => {
    const t = accountTotals(positions, balance);
    expect(t.positionsValue).toBeCloseTo(60_602.3, 2);
    expect(t.totalAccountValue).toBeCloseTo(53_938.35, 2);
  });

  test("gross is before the debit and is not the account value", () => {
    // Reporting gross as "account value" overstates by the whole debit —
    // $60,602.68 against a real $53,938.35 here.
    const t = accountTotals(positions, balance);
    expect(t.grossValue).toBeCloseTo(60_602.68, 2);
    expect(t.grossValue - t.totalAccountValue).toBeCloseTo(6_664.33, 2);
  });

  test("the debit is subtracted, not added", () => {
    // Sign errors on a debit are silent and enormous. Pin the direction.
    const withDebit = accountTotals(positions, balance).totalAccountValue;
    const noDebit = accountTotals(positions, { cash: 0.38, margin_used: 0 }).totalAccountValue;
    expect(withDebit).toBeLessThan(noDebit);
  });

  test("equity percent matches Fidelity's 89% to the tenth", () => {
    // Statement says equity 89.00%; 53,938.35 / 60,602.68 = 0.8900.
    const t = accountTotals(positions, balance);
    expect(t.equityPct!).toBeCloseTo(0.89, 3);
  });
});

describe("unrealized P/L is scoped to the same positions as the value", () => {
  const positions: PositionLike[] = [
    { quantity: 10, cost_basis: 100, current_price: 150 }, // +500
    { quantity: 5, cost_basis: 200, current_price: 180 }, // −100
  ];

  test("market value minus cost basis", () => {
    const t = accountTotals(positions, { cash: 0, margin_used: 0 });
    expect(t.positionsValue).toBe(2_400);
    expect(t.costBasis).toBe(2_000);
    expect(t.unrealizedPL).toBe(400);
    expect(t.unrealizedPLPct!).toBeCloseTo(0.2, 10);
  });

  test("cash does not leak into P/L", () => {
    // P/L is about positions. Adding cash to it would inflate the figure by an
    // amount that never moved.
    const withCash = accountTotals(positions, { cash: 50_000, margin_used: 0 });
    expect(withCash.unrealizedPL).toBe(400);
  });

  test("a live price overrides the stored one, for both sides", () => {
    const t = accountTotals(positions, { cash: 0, margin_used: 0 }, () => 100);
    expect(t.positionsValue).toBe(1_500);
    expect(t.unrealizedPL).toBe(-500);
  });
});

describe("absent data reads as absent, never as zero", () => {
  test("no positions and no balance gives zeroes but null ratios", () => {
    const t = accountTotals([], null);
    expect(t.totalAccountValue).toBe(0);
    // A percentage with no denominator is not 0% — it is unknown. Showing 0%
    // would be a claim the data does not support.
    expect(t.equityPct).toBeNull();
    expect(t.unrealizedPLPct).toBeNull();
  });

  test("null cash and margin are treated as zero, not NaN", () => {
    const t = accountTotals([{ quantity: 1, cost_basis: 1, current_price: 2 }], {
      cash: null,
      margin_used: undefined,
    });
    expect(t.totalAccountValue).toBe(2);
    expect(Number.isNaN(t.totalAccountValue)).toBe(false);
  });

  test("a non-finite price does not poison the total", () => {
    const t = accountTotals(
      [{ quantity: 1, cost_basis: 1, current_price: Number.NaN }],
      { cash: 10, margin_used: 0 },
    );
    expect(t.totalAccountValue).toBe(10);
  });
});

describe("scope labelling", () => {
  test("every scope produces a label — an unlabelled figure is the defect", () => {
    const scopes: AccountScope[] = [
      { kind: "account", accountId: "a", accountName: "Amir — TOD" },
      { kind: "all", accountCount: 6 },
      { kind: "none" },
    ];
    for (const s of scopes) {
      expect(scopeLabel(s).length).toBeGreaterThan(0);
    }
  });

  test("a single account is named, not described generically", () => {
    expect(scopeLabel({ kind: "account", accountId: "a", accountName: "Amir — TOD" }))
      .toBe("Amir — TOD");
  });

  test("all-accounts says how many, so blending is visible", () => {
    expect(scopeLabel({ kind: "all", accountCount: 6 })).toBe("All 6 accounts");
  });

  test("no selection is empty, and so is an all-scope over zero accounts", () => {
    expect(scopeIsEmpty({ kind: "none" })).toBe(true);
    expect(scopeIsEmpty({ kind: "all", accountCount: 0 })).toBe(true);
    expect(scopeIsEmpty({ kind: "all", accountCount: 1 })).toBe(false);
  });
});

describe("scoped rows never leak across accounts", () => {
  // The live bug in one fixture: TOD, the IRA, a kid's account, and a manual
  // row that was never assigned to any account.
  const rows = [
    { id: "a1", account_id: "tod" },
    { id: "a2", account_id: "tod" },
    { id: "b1", account_id: "ira" },
    { id: "c1", account_id: "kid-529" },
    { id: "m1", account_id: null },
  ];
  const tod: AccountScope = { kind: "account", accountId: "tod", accountName: "Amir — TOD" };

  test("an account scope returns that account's rows and nothing else", () => {
    expect(scopedRows(rows, tod).map((r) => r.id)).toEqual(["a1", "a2"]);
  });

  test("no scope ever returns a row belonging to another account", () => {
    // The regression, stated as the invariant rather than as one example: for
    // every single-account scope, every returned row is either that account's
    // or explicitly unassigned. An unfiltered select fails this immediately.
    for (const accountId of ["tod", "ira", "kid-529", "does-not-exist"]) {
      for (const includeUnassigned of [false, true]) {
        const out = scopedRows(
          rows,
          { kind: "account", accountId, accountName: accountId },
          { includeUnassigned },
        );
        for (const r of out) {
          const ok = r.account_id === accountId || (includeUnassigned && r.account_id === null);
          expect(ok).toBe(true);
        }
      }
    }
  });

  test("an unresolvable account yields nothing, not everything", () => {
    // This is the shape of the failure: a renamed or deleted account must not
    // fall through to the household.
    expect(scopedRows(rows, { kind: "account", accountId: "gone", accountName: "gone" })).toEqual(
      [],
    );
  });

  test("no selection yields nothing, even with includeUnassigned", () => {
    // Unassigned rows must not stand in for an account that was never chosen —
    // that rendered a plausible but wrong portfolio with no error.
    expect(scopedRows(rows, { kind: "none" }, { includeUnassigned: true })).toEqual([]);
  });

  test("all-accounts returns everything, and only when asked by name", () => {
    expect(scopedRows(rows, { kind: "all", accountCount: 3 })).toHaveLength(rows.length);
  });

  test("includeUnassigned adds accountless rows and still no foreign ones", () => {
    expect(scopedRows(rows, tod, { includeUnassigned: true }).map((r) => r.id)).toEqual([
      "a1",
      "a2",
      "m1",
    ]);
  });

  test("scoping does not mutate the input", () => {
    const before = rows.map((r) => r.id);
    scopedRows(rows, { kind: "all", accountCount: 3 });
    scopedRows(rows, tod);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe("totals over a scope match the formula, not the household", () => {
  // Negative control for the live bug: if the totals were computed over every
  // row instead of the scoped ones, this test is the thing that fails.
  const holdings = [
    { account_id: "tod", quantity: 100, cost_basis: 500, current_price: 606.023 },
    { account_id: "ira", quantity: 50, cost_basis: 100, current_price: 200 },
    { account_id: "kid-529", quantity: 10, cost_basis: 20, current_price: 30 },
  ];
  const tod: AccountScope = { kind: "account", accountId: "tod", accountName: "Amir — TOD" };

  test("the TOD total is the TOD statement, with the other accounts present", () => {
    const t = accountTotals(scopedRows(holdings, tod), { cash: 0.38, margin_used: 6_664.33 });
    expect(t.positionCount).toBe(1);
    expect(t.totalAccountValue).toBeCloseTo(53_938.35, 2);
  });

  test("blending every account overstates the same figure", () => {
    const blended = accountTotals(holdings, { cash: 0.38, margin_used: 6_664.33 });
    expect(blended.totalAccountValue).toBeGreaterThan(53_938.35);
  });
});
