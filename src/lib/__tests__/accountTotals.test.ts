// Stage 1. The live bug: totals blended every account together, because
// `useHoldings()` had no account filter and `useAccount()` summed cash and
// margin across all accounts.
//
// The anchor test is the real Fidelity statement — if the arithmetic does not
// reconcile to the cent against that, nothing else here matters.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  accountTotals,
  scopedRows,
  scopeIsEmpty,
  scopeLabel,
  type AccountScope,
  type PositionLike,
} from "../accountTotals";

describe("reconciles to the Fidelity statement", () => {
  // Synthetic (P0 remediation, 2026-09-05): cash 2,500.00 + margin market
  // value 145,950.00 − net debit 20,000.00 = total account value 128,450.00.
  const positions: PositionLike[] = [
    { quantity: 100, cost_basis: 500, current_price: 1_459.5 }, // 145,950.00
  ];
  const balance = { cash: 2_500, margin_used: 20_000 };

  test("total account value matches to the cent", () => {
    const t = accountTotals(positions, balance);
    expect(t.positionsValue).toBeCloseTo(145_950, 2);
    expect(t.totalAccountValue).toBeCloseTo(128_450, 2);
  });

  test("gross is before the debit and is not the account value", () => {
    // Reporting gross as "account value" overstates by the whole debit —
    // $148,450.00 against a net $128,450.00 here.
    const t = accountTotals(positions, balance);
    expect(t.grossValue).toBeCloseTo(148_450, 2);
    expect(t.grossValue! - t.totalAccountValue!).toBeCloseTo(20_000, 2);
  });

  test("the debit is subtracted, not added", () => {
    // Sign errors on a debit are silent and enormous. Pin the direction.
    const withDebit = accountTotals(positions, balance).totalAccountValue;
    const noDebit = accountTotals(positions, { cash: 2_500, margin_used: 0 }).totalAccountValue;
    expect(withDebit!).toBeLessThan(noDebit!);
  });

  test("equity percent matches the statement's 86.5% to the tenth", () => {
    // Statement says equity 86.50%; 128,450.00 / 148,450.00 = 0.8653.
    const t = accountTotals(positions, balance);
    expect(t.equityPct!).toBeCloseTo(0.8653, 3);
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
  // Both tests in this block used to assert the opposite, one of them by name
  // ("null cash and margin are treated as zero"). That coercion is the rule-13
  // defect Phase 1a repairs: it makes a never-populated account report a total
  // account value short by the whole missing figure, in the same typeface as a
  // figure the broker actually supplied.
  test("no balance at all means the account value is unknown, not zero", () => {
    const t = accountTotals([], null);
    expect(t.cash).toBeNull();
    expect(t.marginDebit).toBeNull();
    expect(t.grossValue).toBeNull();
    expect(t.totalAccountValue).toBeNull();
    // A percentage with no denominator is not 0% — it is unknown. Showing 0%
    // would be a claim the data does not support.
    expect(t.equityPct).toBeNull();
    expect(t.unrealizedPLPct).toBeNull();
  });

  test("null cash makes the value unknown even though the positions are known", () => {
    const t = accountTotals([{ quantity: 1, cost_basis: 1, current_price: 2 }], {
      cash: null,
      margin_used: undefined,
    });
    // The positions are a separate dataset and stay known...
    expect(t.positionsValue).toBe(2);
    // ...but nothing that needs the balance may be stated.
    expect(t.grossValue).toBeNull();
    expect(t.totalAccountValue).toBeNull();
    expect(t.equityPct).toBeNull();
  });

  test("unknown propagates one field at a time", () => {
    const positions = [{ quantity: 1, cost_basis: 1, current_price: 2 }];
    // Cash known, debit unknown: gross is computable, the account value is not.
    const noDebit = accountTotals(positions, { cash: 10, margin_used: null });
    expect(noDebit.grossValue).toBe(12);
    expect(noDebit.totalAccountValue).toBeNull();
    expect(noDebit.equityPct).toBeNull();

    // Debit known, cash unknown: neither is computable.
    const noCash = accountTotals(positions, { cash: null, margin_used: 5 });
    expect(noCash.grossValue).toBeNull();
    expect(noCash.totalAccountValue).toBeNull();
  });

  test("a real zero balance is still a real zero", () => {
    // The point of the change is the DISTINCTION. If null and 0 both became
    // unknown, the fix would have destroyed the other half of it.
    const t = accountTotals([{ quantity: 1, cost_basis: 1, current_price: 2 }], {
      cash: 0,
      margin_used: 0,
    });
    expect(t.cash).toBe(0);
    expect(t.marginDebit).toBe(0);
    expect(t.grossValue).toBe(2);
    expect(t.totalAccountValue).toBe(2);
    expect(t.equityPct).toBe(1);
  });

  test("a non-finite price does not poison the total", () => {
    const t = accountTotals([{ quantity: 1, cost_basis: 1, current_price: Number.NaN }], {
      cash: 10,
      margin_used: 0,
    });
    expect(t.totalAccountValue).toBe(10);
  });
});

describe("scope labelling", () => {
  test("every scope produces a label — an unlabelled figure is the defect", () => {
    const scopes: AccountScope[] = [
      { kind: "account", accountId: "a", accountName: "Individual — TOD" },
      { kind: "all", accountCount: 6 },
      { kind: "none" },
    ];
    for (const s of scopes) {
      expect(scopeLabel(s).length).toBeGreaterThan(0);
    }
  });

  test("a single account is named, not described generically", () => {
    expect(scopeLabel({ kind: "account", accountId: "a", accountName: "Individual — TOD" })).toBe(
      "Individual — TOD",
    );
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
  const tod: AccountScope = { kind: "account", accountId: "tod", accountName: "Individual — TOD" };

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
    { account_id: "tod", quantity: 100, cost_basis: 500, current_price: 1_459.5 },
    { account_id: "ira", quantity: 50, cost_basis: 100, current_price: 200 },
    { account_id: "kid-529", quantity: 10, cost_basis: 20, current_price: 30 },
  ];
  const tod: AccountScope = { kind: "account", accountId: "tod", accountName: "Individual — TOD" };

  test("the TOD total is the TOD statement, with the other accounts present", () => {
    const t = accountTotals(scopedRows(holdings, tod), { cash: 2_500, margin_used: 20_000 });
    expect(t.positionCount).toBe(1);
    expect(t.totalAccountValue).toBeCloseTo(128_450, 2);
  });

  test("blending every account overstates the same figure", () => {
    const blended = accountTotals(holdings, { cash: 2_500, margin_used: 20_000 });
    expect(blended.totalAccountValue).toBeGreaterThan(128_450);
  });
});

// Rule 9: one engine. Five screens each did their own `positions + cash − debt`
// and agreed only by luck — a change to one silently stopped matching the rest.
// These are the concepts they were each computing, now computed once.
describe("the concepts every screen was computing for itself", () => {
  const positions = [{ quantity: 100, cost_basis: 50, current_price: 80 }];
  const balance = { cash: 2_500, margin_used: 20_000, buying_power: 190_000 };

  test("liabilities are held apart from the debt they currently equal", () => {
    // A second liability would otherwise be added to the margin debt and lose
    // its identity, which is how a figure stops being auditable.
    const t = accountTotals(positions, balance);
    expect(t.liabilities).toBe(20_000);
    expect(t.marginDebit).toBe(20_000);
  });

  test("available capital is the broker's figure, not one the app derives", () => {
    // The broker's margin rules decide it and the app does not know them.
    // Computing it from equity would be inventing a broker state.
    const t = accountTotals(positions, balance);
    expect(t.availableCapital).toBe(190_000);
  });

  test("available without borrowing is cash, and only cash", () => {
    const t = accountTotals(positions, balance);
    expect(t.availableWithoutBorrowing).toBe(2_500);
  });

  test("leverage against nothing is undefined, not infinite", () => {
    // An account with no equity and a debt is a margin call, not a 500x
    // position — and rendering it as a number invites someone to read it as one.
    const t = accountTotals(positions, { cash: 0, margin_used: 8_000 });
    expect(t.totalAccountValue).toBe(0);
    expect(t.leverage).toBeNull();
  });

  test("leverage is gross over equity where both are known", () => {
    // gross 10,500 / equity 500 = 21x
    const t = accountTotals([{ quantity: 100, cost_basis: 50, current_price: 100 }], {
      cash: 500,
      margin_used: 10_000,
    });
    expect(t.leverage).toBeCloseTo(21, 4);
  });

  test("margin utilisation is debt over gross — the figure the IPS cap uses", () => {
    const t = accountTotals(positions, balance);
    // 20,000 / 10,500 — a breach, and the point is that it is ONE definition.
    expect(t.marginUtilisation).toBeCloseTo(20_000 / 10_500, 6);
  });

  test("every derived concept goes unknown when its inputs do", () => {
    const t = accountTotals(positions, { cash: null, margin_used: null });
    expect(t.liabilities).toBeNull();
    expect(t.availableWithoutBorrowing).toBeNull();
    expect(t.leverage).toBeNull();
    expect(t.marginUtilisation).toBeNull();
    // ...and buying power is separately unknown, not inherited from the others.
    expect(t.availableCapital).toBeNull();
  });

  test("buying power is not summed into anything", () => {
    // Rule 8. It is available capital and nothing else — the account is not
    // worth more because the broker would lend against it.
    const withBp = accountTotals(positions, balance);
    const withoutBp = accountTotals(positions, { cash: 2_500, margin_used: 20_000 });
    expect(withBp.totalAccountValue).toBe(withoutBp.totalAccountValue);
    expect(withBp.grossValue).toBe(withoutBp.grossValue);
  });
});

// The rule is "every page consumes it, no page recomputes". A convention that
// holds only while someone remembers it is how five copies appeared in the
// first place, so it is asserted against the source.
describe("no screen recomputes the account arithmetic", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((e) => {
      const full = join(dir, e);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });

  /**
   * Live code only.
   *
   * Every source guard in this repo needs this, and this one needed it for a
   * reason worth writing down: the comment explaining WHY the arithmetic was
   * removed necessarily quotes the arithmetic. So the first version of this
   * guard flagged its own documentation — a guard coarser than the fault it
   * catches, which is the recurring own-goal of this whole rebuild. A guard
   * that fires on the explanation pressures the next person to delete the
   * explanation.
   */
  const live = (code: string) =>
    code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("nothing outside the engine sums positions and then adds cash", () => {
    // The specific shape that was duplicated: a reduce over quantity × price,
    // with the account's cash added to it. Matching the PAIR rather than either
    // half — a reduce alone is legitimate (day change, cost basis, sector
    // weights all do one) and flagging it would make this guard noise.
    const offenders: string[] = [];
    for (const file of [...walk("src/routes"), ...walk("src/components")]) {
      const code = live(readFileSync(file, "utf8"));
      const sumsPositions = /reduce\(\([^)]*\)\s*=>[^;]*\.quantity\s*\*/.test(code);
      const addsCash = /\+\s*Number\(\s*\w+\.cash|cash\s*===\s*null\s*\?\s*null\s*:\s*\w+\s*\+/.test(
        code,
      );
      if (sumsPositions && addsCash) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test("nothing outside the engine subtracts the margin debt", () => {
    // `positions + cash − margin_used` written out by hand is the whole defect.
    const offenders: string[] = [];
    for (const file of [...walk("src/routes"), ...walk("src/components")]) {
      const code = live(readFileSync(file, "utf8"));
      if (/-\s*Number\(\s*\w+\.margin_used/.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
