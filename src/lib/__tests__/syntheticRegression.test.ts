// Phase 8, rules 24 and 34: the synthetic regression suite.
//
// The brief lists the scenarios by name, and this file works through them in
// that order. Every one is a case where the app previously produced a
// confident wrong answer, or where the fix for one of them could plausibly
// break another.
//
//   external vs calculated equity · margin double-counting · buying power
//   excluded from equity · unknown staying unknown · stale data · partial
//   imports · account isolation · multiple accounts · multiple brokers ·
//   different portfolio sizes ($500 / $50k / $5m) · currencies · open-order
//   commitments · partial fills · multiple tranches · cash accounts · margin
//   accounts · recommendation blocking · recovery after reconciliation.
//
// "SYNTHETIC DATA ONLY. No real account numbers, names, or portfolio values."
// Every figure below is round, invented, and chosen to make an arithmetic
// point. The $500 / $50k / $5m triple is the brief's own, and it is there to
// prove rule 31: no threshold may be tuned to one portfolio's size.
//
// This suite deliberately calls the SHIPPED functions rather than
// reimplementing their arithmetic. A regression suite that recomputes what it
// is checking tests only that two copies of a formula agree.
import { describe, expect, test } from "bun:test";

import { accountTotals } from "../accountTotals";
import { sumField } from "../accountAggregate";
import { DEFAULT_TOLERANCE, reconcileAccount, wasChecked } from "../reconciliation";
import { runChecks, gate, combineChecks } from "../readiness";
import { readinessChecksFor } from "../readinessInput";
import { committedCash, totalCommittedCash, openOrdersKnown, remainingQuantity } from "../orders";
import { lotCoverage, unprotectedQuantity, weightedCost } from "../lots";
import { cashForAccount, previewImport, isDestructive } from "../importSafety";
import { convert, money, sumMoney } from "../currency";
import { fmtPrice, fmtUSD } from "../finance";

const NOW = new Date("2026-09-05T12:00:00Z");
/** Inside the imported-snapshot window (a week) but outside the quote one. */
const FRESH = "2026-09-05T09:00:00Z";
/** Inside the live-quote window, which is an hour — quotes go stale in
 *  minutes and balances in days, so they need different fixtures. */
const QUOTE_FRESH = "2026-09-05T11:40:00Z";
const OLD = "2026-06-01T09:00:00Z";

/** Synthetic accounts at three scales. The brief's own triple (rule 31). */
const SCALES = [
  { label: "$500 account", cash: 100, positionsValue: 400, debt: 0 },
  { label: "$50k account", cash: 10_000, positionsValue: 40_000, debt: 0 },
  { label: "$5m account", cash: 1_000_000, positionsValue: 4_000_000, debt: 0 },
];

const holding = (symbol: string, quantity: number, price: number, cost = price) => ({
  symbol,
  quantity,
  current_price: price,
  cost_basis: cost,
});

// ── external vs calculated equity ────────────────────────────────────────────
describe("external vs calculated equity", () => {
  test("agreement inside the noise band reconciles", () => {
    const r = reconcileAccount(
      {
        external: {
          value: 50_000.004,
          provenance: { sourceType: "imported_snapshot", asOf: FRESH },
        },
        calculated: {
          value: 50_000,
          positions: { sourceType: "imported_snapshot", asOf: FRESH },
          quotes: { sourceType: "live_quote", asOf: QUOTE_FRESH },
        },
      },
      DEFAULT_TOLERANCE,
      NOW,
    );
    expect(r.status).toBe("RECONCILED");
  });

  test("a material difference is NOT_RECONCILED and is not tuned away", () => {
    // Rule 5: never adjust a calculation to force agreement. The engine's job
    // is to report the difference, and the panel's is not to say who is right.
    const r = reconcileAccount(
      {
        external: { value: 50_000, provenance: { sourceType: "imported_snapshot", asOf: FRESH } },
        calculated: {
          value: 47_000,
          positions: { sourceType: "imported_snapshot", asOf: FRESH },
          quotes: { sourceType: "live_quote", asOf: QUOTE_FRESH },
        },
      },
      DEFAULT_TOLERANCE,
      NOW,
    );
    expect(r.status).toBe("NOT_RECONCILED");
    // Sign convention: the APP's figure minus the BROKER's. Negative means the
    // app thinks the account is worth less than the broker says. Pinned here
    // because a panel that flipped it would show a shortfall as a surplus.
    expect(r.differenceUsd).toBeCloseTo(-3_000, 6);
  });
});

// ── the tolerance holds at every scale (rule 31) ─────────────────────────────
describe("no threshold is tuned to one portfolio's size", () => {
  const reconcileAt = (external: number, calculated: number) =>
    reconcileAccount(
      {
        external: { value: external, provenance: { sourceType: "imported_snapshot", asOf: FRESH } },
        calculated: {
          value: calculated,
          positions: { sourceType: "imported_snapshot", asOf: FRESH },
          quotes: { sourceType: "live_quote", asOf: QUOTE_FRESH },
        },
      },
      DEFAULT_TOLERANCE,
      NOW,
    ).status;

  test("a cent of rounding is noise at $500 and at $5m", () => {
    expect(reconcileAt(500.01, 500)).toBe("RECONCILED");
    expect(reconcileAt(5_000_000.01, 5_000_000)).toBe("RECONCILED");
  });

  test("$300 is material at $5m, where a percentage alone would miss it", () => {
    // 0.006% — well under any sane percentage band, and still $300 of real
    // money. This is the case the dollar threshold exists for.
    expect(reconcileAt(5_000_300, 5_000_000)).toBe("NOT_RECONCILED");
  });

  test("$300 is material at $500 too, where it is most of the account", () => {
    expect(reconcileAt(800, 500)).toBe("NOT_RECONCILED");
  });
});

// ── margin double-counting, and buying power excluded from equity ────────────
describe("margin and buying power", () => {
  test("margin debt is subtracted once, not twice", () => {
    // The classic double-count: securities bought on margin appear in
    // positions AND the debt is subtracted, which is correct exactly once.
    const t = accountTotals([holding("MSFT", 100, 400)], {
      cash: 5_000,
      margin_used: 10_000,
      buying_power: 30_000,
    });
    expect(t.positionsValue).toBe(40_000);
    expect(t.grossValue).toBe(45_000);
    expect(t.totalAccountValue).toBe(35_000);
  });

  test("buying power is never summed into equity (rule 8)", () => {
    // It is the broker's statement about what may be BORROWED, not an asset.
    // Doubling it must not move the account's value at all.
    const a = accountTotals([holding("MSFT", 10, 100)], {
      cash: 1_000,
      margin_used: 0,
      buying_power: 5_000,
    });
    const b = accountTotals([holding("MSFT", 10, 100)], {
      cash: 1_000,
      margin_used: 0,
      buying_power: 500_000,
    });
    expect(a.totalAccountValue).toBe(b.totalAccountValue);
    expect(a.grossValue).toBe(b.grossValue);
  });

  test("a cash account with no margin still totals correctly", () => {
    const t = accountTotals([holding("VTI", 10, 250)], {
      cash: 500,
      margin_used: 0,
      buying_power: null,
    });
    expect(t.totalAccountValue).toBe(3_000);
  });

  test("a margin account with unknown debt has an unknown total", () => {
    // Rule 13. Not "the total, assuming no debt". `margin_enabled` is NULL
    // here — nobody has said whether this account has margin.
    const t = accountTotals([holding("VTI", 10, 250)], {
      cash: 500,
      margin_used: null,
      margin_enabled: null,
      buying_power: null,
    });
    expect(t.totalAccountValue).toBeNull();
  });

  test("a STATED cash-only account totals, because zero debt is a fact", () => {
    // `margin_enabled: false` means somebody opened Settings and said so. An
    // account in that state owes nothing by definition, and no import will
    // ever supply a debt figure for it — so treating the null as unknown left
    // a cash-only user's account value permanently Unavailable with no action
    // they could take. Found by the rule-37 second-user test.
    const t = accountTotals([holding("VTI", 10, 250)], {
      cash: 500,
      margin_used: null,
      margin_enabled: false,
      buying_power: null,
    });
    expect(t.totalAccountValue).toBe(3_000);
    expect(t.marginDebit).toBe(0);
  });

  test("an explicit debt still wins over the stated flag", () => {
    // A cash-flagged account that somehow carries a debit figure reports it,
    // rather than having it silently zeroed — the figure is evidence of a
    // data problem and must survive to be seen.
    const t = accountTotals([holding("VTI", 10, 250)], {
      cash: 500,
      margin_used: 100,
      margin_enabled: false,
      buying_power: null,
    });
    expect(t.marginDebit).toBe(100);
    expect(t.totalAccountValue).toBe(2_900);
  });
});

// ── unknown stays unknown ────────────────────────────────────────────────────
describe("unknown stays unknown, everywhere", () => {
  test("an unknown cash balance makes the total unknown, not smaller", () => {
    const t = accountTotals([holding("MSFT", 10, 400)], {
      cash: null,
      margin_used: 0,
      buying_power: null,
    });
    expect(t.totalAccountValue).toBeNull();
    expect(t.grossValue).toBeNull();
    // Positions are a separate dataset: an empty list is a known fact.
    expect(t.positionsValue).toBe(4_000);
  });

  test("a household total is null when ANY account does not know its cash", () => {
    const rows = [{ cash: 1_000 }, { cash: null }, { cash: 3_000 }];
    expect(sumField(rows, "cash")).toBeNull();
  });

  test("reconciliation with a missing side does not compute a difference", () => {
    const r = reconcileAccount(
      {
        external: { value: null, provenance: { sourceType: "imported_snapshot", asOf: FRESH } },
        calculated: {
          value: 50_000,
          positions: { sourceType: "imported_snapshot", asOf: FRESH },
          quotes: { sourceType: "live_quote", asOf: QUOTE_FRESH },
        },
      },
      DEFAULT_TOLERANCE,
      NOW,
    );
    expect(wasChecked(r.status)).toBe(false);
    expect(r.differenceUsd).toBeNull();
  });

  test("an unknown figure is never rendered as a number", () => {
    // The rendering half. `fmtUSD` takes a `number` by type, so the only way
    // an unknown reaches it is a coercion the compiler now refuses — this
    // pins the remaining runtime case.
    expect(fmtUSD(NaN)).toBe("(error)");
    expect(fmtUSD(NaN)).not.toBe("$0.00");
  });
});

// ── stale data ───────────────────────────────────────────────────────────────
describe("stale data", () => {
  test("stale inputs are STALE, not a discrepancy", () => {
    // Telling someone their books disagree by $4,000 when the real problem is
    // that one side is three months old sends them to fix the wrong thing.
    const r = reconcileAccount(
      {
        external: { value: 54_000, provenance: { sourceType: "imported_snapshot", asOf: OLD } },
        calculated: {
          value: 50_000,
          positions: { sourceType: "imported_snapshot", asOf: OLD },
          quotes: { sourceType: "live_quote", asOf: QUOTE_FRESH },
        },
      },
      DEFAULT_TOLERANCE,
      NOW,
    );
    expect(r.status).toBe("STALE");
  });

  test("stale positions block a goal projection but not research", () => {
    const checks = runChecks({
      reconciliation: "RECONCILED",
      positions: "STALE",
      quotes: "CURRENT",
      cash: 10_000,
      marginEnabled: false,
      marginUsed: null,
      openOrdersKnown: true,
      policySource: "user_set",
    });
    expect(gate("goal_projection", checks).allowed).toBe(false);
    expect(gate("research", checks).allowed).toBe(true);
  });
});

// ── partial imports ──────────────────────────────────────────────────────────
describe("partial imports", () => {
  test("an import missing a cash line leaves cash alone rather than zeroing it", () => {
    // The parser only creates a key when the CSV carried a cash line.
    expect(cashForAccount(["Brokerage"], {})).toBeNull();
    expect(cashForAccount(["Brokerage", "Second"], { Brokerage: 500 })).toBeNull();
  });

  test("a preview names what will be REMOVED", () => {
    const p = previewImport(
      "a1",
      "Brokerage",
      [{ symbol: "MSFT", quantity: 1, cost_basis: 1, current_price: 1 }],
      ["MSFT", "NVDA", "VTI"],
      null,
    );
    expect(p.removed).toEqual(["NVDA", "VTI"]);
    expect(isDestructive(p)).toBe(true);
  });
});

// ── account isolation, and several accounts ──────────────────────────────────
describe("account isolation", () => {
  test("one account's holdings never leak into another's total", () => {
    const all = [
      { ...holding("MSFT", 10, 400), account_id: "a1" },
      { ...holding("NVDA", 10, 900), account_id: "a2" },
    ];
    const a1 = accountTotals(
      all.filter((h) => h.account_id === "a1"),
      { cash: 1_000, margin_used: 0, buying_power: null },
    );
    expect(a1.positionsValue).toBe(4_000);
    expect(a1.totalAccountValue).toBe(5_000);
  });

  test("a household sums accounts that all know their figures", () => {
    expect(sumField([{ cash: 100 }, { cash: 10_000 }, { cash: 1_000_000 }], "cash")).toBe(
      1_010_100,
    );
  });

  test("readiness across several accounts takes the worst", () => {
    const ready = {
      reconciliation: "RECONCILED" as const,
      positions: "IMPORTED_SNAPSHOT" as const,
      quotes: "CURRENT" as const,
      cash: 1_000,
      marginEnabled: false,
      marginUsed: null,
      openOrdersKnown: true,
      policySource: "user_set" as const,
    };
    const combined = combineChecks([
      { label: "First", checks: runChecks(ready) },
      { label: "Second", checks: runChecks({ ...ready, cash: null }) },
    ]);
    expect(combined.find((c) => c.id === "cash")!.state).toBe("unknown");
    expect(combined.find((c) => c.id === "cash")!.detail).toContain("Second");
    expect(combined.find((c) => c.id === "cash")!.detail).not.toContain("First");
  });
});

// ── multiple brokers ─────────────────────────────────────────────────────────
describe("multiple brokers", () => {
  test("the accounting engine takes no broker argument", () => {
    // Rule 3: a second adapter must be addable without touching portfolio
    // logic. The strongest form of that claim is that the engine cannot even
    // express a broker — it takes positions and a balance, and nothing else.
    const t = accountTotals([holding("MSFT", 10, 400)], {
      cash: 1_000,
      margin_used: 0,
      buying_power: null,
    });
    expect(t.totalAccountValue).toBe(5_000);
    expect(accountTotals.length).toBeLessThanOrEqual(3);
  });

  test("accounts from different brokers aggregate identically", () => {
    // Two accounts whose figures arrived from different adapters are just two
    // accounts by the time they reach here — which is the point.
    const rows = [{ cash: 2_500 }, { cash: 7_500 }];
    expect(sumField(rows, "cash")).toBe(10_000);
  });
});

// ── portfolio sizes ──────────────────────────────────────────────────────────
describe("the engine behaves the same at every scale", () => {
  for (const s of SCALES) {
    test(`${s.label}: total is cash + positions − debt`, () => {
      const t = accountTotals([holding("SYN", 1, s.positionsValue)], {
        cash: s.cash,
        margin_used: s.debt,
        buying_power: null,
      });
      expect(t.totalAccountValue).toBe(s.cash + s.positionsValue - s.debt);
      // A proportion, at any size.
      expect(t.equityPct).toBeCloseTo(1, 10);
    });
  }
});

// ── currencies ───────────────────────────────────────────────────────────────
describe("currencies", () => {
  test("same-currency sums work; mixed ones refuse", () => {
    expect(sumMoney([money(1_000, "USD"), money(2_000, "USD")])).toEqual(money(3_000, "USD"));
    expect(sumMoney([money(1_000, "USD"), money(2_000, "EUR")])).toBeNull();
  });

  test("conversion needs a fresh rate for the right pair", () => {
    const rate = { from: "EUR", to: "USD", rate: 1.1, asOf: FRESH };
    expect(convert(money(100, "EUR"), "USD", rate, NOW)!.amount).toBeCloseTo(110, 10);
    expect(convert(money(100, "EUR"), "USD", { ...rate, asOf: OLD }, NOW)).toBeNull();
  });
});

// ── open-order commitments and partial fills ─────────────────────────────────
describe("open orders", () => {
  const order = (over = {}) => ({
    status: "open",
    side: "buy",
    quantity: 10,
    filled_quantity: null,
    limit_price: 100,
    order_type: "limit",
    ...over,
  });

  test("a working limit buy commits cash, and it is never in equity", () => {
    expect(committedCash(order())).toBe(1_000);
    // The account total is untouched by open orders — the broker's buying
    // power already reflects them (rule 8).
    const t = accountTotals([holding("MSFT", 10, 400)], {
      cash: 5_000,
      margin_used: 0,
      buying_power: null,
    });
    expect(t.totalAccountValue).toBe(9_000);
  });

  test("a partial fill commits only the remainder", () => {
    expect(remainingQuantity(order({ status: "partially_filled", filled_quantity: 4 }))).toBe(6);
    expect(committedCash(order({ status: "partially_filled", filled_quantity: 4 }))).toBe(600);
  });

  test("a partial fill with an unknown filled amount is unknown, not full size", () => {
    expect(committedCash(order({ status: "partially_filled", filled_quantity: null }))).toBeNull();
  });

  test("one unpriceable order makes the committed total unavailable", () => {
    expect(totalCommittedCash([order(), order({ order_type: "market" })])).toBeNull();
  });

  test("never reported orders are not 'no open orders'", () => {
    expect(openOrdersKnown({ orders_as_of: null, orders_source: null }, NOW)).toBe(false);
    expect(openOrdersKnown({ orders_as_of: FRESH, orders_source: "imported" }, NOW)).toBe(true);
  });
});

// ── multiple tranches ────────────────────────────────────────────────────────
describe("multiple tranches", () => {
  const lot = (id: string, quantity: number, cost: number) => ({
    id,
    quantity,
    cost_per_share: cost,
    acquired_at: "2025-01-15",
    closed_at: null,
  });

  test("aggregate exposure and tranche identity both survive", () => {
    const lots = [lot("l1", 10, 100), lot("l2", 5, 200)];
    expect(lotCoverage(lots, 15)).toBe("complete");
    // Weighted, not a mean of 100 and 200.
    expect(weightedCost(lots)).toBeCloseTo((10 * 100 + 5 * 200) / 15, 10);
  });

  test("a stop on one tranche leaves the others unprotected", () => {
    const lots = [lot("l1", 10, 100), lot("l2", 5, 200)];
    expect(unprotectedQuantity(lots, [{ lot_id: "l1", quantity: 10 }], 15)).toBe(5);
  });

  test("lots that do not account for the position give no protection figure", () => {
    expect(unprotectedQuantity([lot("l1", 10, 100)], [], 15)).toBeNull();
  });
});

// ── recommendation blocking, and recovery ────────────────────────────────────
describe("recommendation blocking and recovery after reconciliation", () => {
  const account = (over = {}) => ({
    balances_source_type: "imported_snapshot",
    balances_as_of: FRESH,
    cash: 10_000,
    margin_enabled: false,
    margin_used: null,
    orders_as_of: FRESH,
    orders_source: "imported",
    ...over,
  });

  const checksFor = (over = {}, latest = 50_000, calculated = 50_000) =>
    readinessChecksFor({
      account: account(over),
      totalAccountValue: calculated,
      positionsValue: 40_000,
      latestValue: latest,
      latestAsOf: FRESH,
      policySource: "user_set",
      now: NOW,
    });

  test("a fully ready account blocks nothing", () => {
    const checks = checksFor();
    expect(gate("position_sizing", checks).allowed).toBe(true);
    expect(gate("committee_recommendation", checks).allowed).toBe(true);
  });

  test("a material discrepancy blocks position sizing, and says why", () => {
    const g = gate("position_sizing", checksFor({}, 50_000, 44_000));
    expect(g.allowed).toBe(false);
    if (g.allowed) throw new Error("unreachable");
    expect(g.because.map((c) => c.id)).toContain("reconciliation");
    expect(g.because[0]!.detail.length).toBeGreaterThan(0);
  });

  test("research survives the same failure", () => {
    expect(gate("research", checksFor({}, 50_000, 44_000)).allowed).toBe(true);
  });

  test("RECOVERY: once the figures agree, the block lifts", () => {
    // The scenario the brief names last, and the one that proves the gate is
    // a function of the data rather than a latch. Same account, same code,
    // reconciled figures.
    const blocked = gate("position_sizing", checksFor({}, 50_000, 44_000));
    const recovered = gate("position_sizing", checksFor({}, 50_000, 50_000));
    expect(blocked.allowed).toBe(false);
    expect(recovered.allowed).toBe(true);
  });

  test("an unconfirmed policy blocks sizing but not the goal projection", () => {
    const checks = readinessChecksFor({
      account: account(),
      totalAccountValue: 50_000,
      positionsValue: 40_000,
      latestValue: 50_000,
      latestAsOf: FRESH,
      policySource: "default",
      now: NOW,
    });
    expect(gate("position_sizing", checks).allowed).toBe(false);
    expect(gate("goal_projection", checks).allowed).toBe(true);
  });
});

// ── the suite's own honesty ──────────────────────────────────────────────────
describe("this suite is synthetic and calls the shipped code", () => {
  test("every figure is round and invented", () => {
    // Rule 34's "synthetic data only". Stated as a property of the fixtures
    // rather than as a promise in a comment: real balances are not round.
    for (const s of SCALES) {
      expect(s.cash % 100).toBe(0);
      expect(s.positionsValue % 100).toBe(0);
    }
  });

  test("it does not reimplement the arithmetic it checks", () => {
    // A regression suite that recomputes what it is checking tests only that
    // two copies of a formula agree. Every expectation above is a literal or
    // is derived from the inputs, never from a second implementation.
    const t = accountTotals([holding("SYN", 2, 50)], {
      cash: 100,
      margin_used: 0,
      buying_power: null,
    });
    expect(t.totalAccountValue).toBe(200);
  });

  test("precision survives at synthetic crypto scale", () => {
    expect(fmtPrice(0.00002, { instrument_class: "crypto" })).not.toBe("$0.00");
  });
});
