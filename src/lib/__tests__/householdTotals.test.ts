// One unknown account makes the household unknown, not smaller (audit brief G4).
//
// This roll-up lived in a ~50-line IIFE inside the dashboard's JSX with no
// tests. Its own comment records why that mattered: the strip once held a
// private copy of `positions + cash − debt` containing
// `Number(a.cash ?? 0) - Number(a.margin_used ?? 0)`, which turned an
// unpopulated account's UNKNOWN balance into a real zero inside the HOUSEHOLD
// total — the place it is least visible.
//
// Synthetic throughout (ADR-APP-012 rules 23-25).
import { describe, expect, test } from "bun:test";
import { householdRollup } from "@/lib/householdTotals";
import type { HouseholdAccount, HouseholdHolding } from "@/lib/householdTotals";

const px = (h: HouseholdHolding) => h.current_price;

const holding = (accountId: string, symbol: string, qty: number, price: number) => ({
  account_id: accountId,
  symbol,
  quantity: qty,
  cost_basis: price / 2,
  current_price: price,
});

const account = (id: string, over: Partial<HouseholdAccount> = {}): HouseholdAccount => ({
  id,
  cash: 10_000,
  margin_used: 0,
  ...over,
});

describe("unknown propagates", () => {
  const holdings = [holding("a", "NVDA", 100, 100), holding("b", "MSFT", 100, 200)];

  test("a fully known household totals", () => {
    const r = householdRollup([account("a"), account("b")], holdings, undefined, px);
    // (10,000 + 10,000) + (10,000 + 20,000) = 50,000
    expect(r.total).toBe(50_000);
  });

  test("ONE account with unknown cash makes the whole household unknown", () => {
    const r = householdRollup(
      [account("a"), account("b", { cash: null })],
      holdings,
      undefined,
      px,
    );
    expect(r.total).toBeNull();
    // Emphatically not the sum of the accounts it could read.
    expect(r.total).not.toBe(20_000);
  });

  test("a later KNOWN account does not restore an already-unknown total", () => {
    // Order matters for a naive accumulator: unknown first, known second.
    const r = householdRollup(
      [account("a", { cash: null }), account("b")],
      holdings,
      undefined,
      px,
    );
    expect(r.total).toBeNull();
  });

  test("an unknown margin debit is as disqualifying as unknown cash", () => {
    const r = householdRollup(
      [account("a"), account("b", { margin_used: null })],
      holdings,
      undefined,
      px,
    );
    expect(r.total).toBeNull();
  });

  test("a real zero balance is known, and totals normally", () => {
    // The distinction the original coercion destroyed.
    const r = householdRollup(
      [account("a"), account("b", { cash: 0, margin_used: 0 })],
      holdings,
      undefined,
      px,
    );
    expect(r.total).toBe(40_000);
  });
});

describe("per-category roll-up", () => {
  const holdings = [holding("a", "NVDA", 100, 100)];

  test("an unknown account makes only ITS category unknown", () => {
    // Both accounts land in the same category here, so this asserts the shape
    // rather than the split: the group carries null, and the group total and
    // the household total agree about it.
    const r = householdRollup([account("a", { cash: null })], holdings, undefined, px);
    const groups = [...r.groups.values()];
    expect(groups).toHaveLength(1);
    expect(groups[0].net).toBeNull();
    expect(r.total).toBeNull();
  });

  test("groups sum the accounts inside them", () => {
    const r = householdRollup([account("a"), account("b")], holdings, undefined, px);
    const summed = [...r.groups.values()].reduce((s, g) => s + (g.net ?? 0), 0);
    // Both are known in this fixture; assert that explicitly rather than
    // widening the type, so a null slipping in fails here instead of passing
    // through a `?? 0` on both sides.
    expect(r.total).not.toBeNull();
    expect(summed).toBe(r.total as number);
  });

  test("no accounts is an empty roll-up, not a zero household", () => {
    const r = householdRollup([], holdings, undefined, px);
    expect(r.groups.size).toBe(0);
    // Zero here is the arithmetic identity over an empty list; the STRIP
    // renders nothing at all in this case, which is the honest display.
    expect(r.total).toBe(0);
  });
});

describe("day change is quote-derived, and survives an unknown balance", () => {
  const holdings = [holding("a", "NVDA", 100, 110)];
  const quotes = { NVDA: { price: 110, prevClose: 100 } };

  test("a known day change on an account whose BALANCE is unknown", () => {
    // The deliberate exception: the day change comes from live quotes, not from
    // stored balances, so it stays knowable when the balance is not.
    const r = householdRollup([account("a", { cash: null })], holdings, quotes, px);
    expect(r.total).toBeNull();
    expect(r.totalDay).toBe(1_000); // 100 × (110 − 100)
  });

  test("no previous close contributes nothing rather than asserting zero", () => {
    const r = householdRollup([account("a")], holdings, { NVDA: { price: 110, prevClose: 0 } }, px);
    expect(r.totalDay).toBe(0);
  });

  test("no quotes at all is a zero day change, not a crash", () => {
    expect(householdRollup([account("a")], holdings, undefined, px).totalDay).toBe(0);
  });
});
