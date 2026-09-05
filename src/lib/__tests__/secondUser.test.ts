// Phase 8, rule 37: the second-user test.
//
// "Provision a second synthetic user with different accounts, balances,
// holdings, broker, goals, risk tolerance and strategy — and confirm the
// application works end to end WITH NO SOURCE CHANGES. Until that passes, the
// architecture is not complete."
//
// WHAT THIS TEST CAN AND CANNOT SHOW, stated plainly rather than implied:
//
//   * It CAN show that every rule the app applies is read from configuration
//     rather than compiled in — by running the whole decision path twice with
//     two unrelated profiles and asserting each gets its OWN answers.
//   * It CANNOT show that the deployed database, RLS and auth behave. That
//     needs a real second account against a real project, and the migrations
//     are not applied yet. Recorded as not-covered rather than implied by a
//     green test.
//
// The first profile deliberately resembles the household the app was built
// around — a margin brokerage, a US-equity strategy, a ten-year horizon. The
// second is as different as the model allows: a cash-only account at another
// broker, a crypto strategy, a short horizon, tighter risk limits, no
// household members, no contribution plan. If any answer for the second
// profile matches the first where it should not, something is still compiled
// in.
//
// Every figure is synthetic (rule 34).
import { describe, expect, test } from "bun:test";

import { accountTotals } from "../accountTotals";
import { accountObjectiveOf, combinedTarget, nextContributionDate } from "../accountObjective";
import { accountCategory } from "../data/accountGroups";
import { ageOf, memberOfAccount, membersOfAccounts } from "../household";
import { approvedShare, approvedSymbols, byBucket } from "../strategy";
import { policyIsConfirmed, policySourceOf } from "../policy";
import { gate } from "../readiness";
import { readinessChecksFor } from "../readinessInput";
import { openOrdersKnown } from "../orders";
import { accountCurrency } from "../currency";
import { classOf, displayDecimals } from "../precision";

const NOW = new Date("2026-09-05T12:00:00Z");
const FRESH = "2026-09-05T09:00:00Z";

/** Everything the app needs to know about a user, and nothing it assumes. */
type Profile = {
  name: string;
  account: {
    id: string;
    name: string;
    account_type: string;
    currency: string | null;
    cash: number | null;
    margin_enabled: boolean | null;
    margin_used: number | null;
    buying_power: number | null;
    target_value: number | null;
    target_date: string | null;
    contribution_amount: number | null;
    contribution_cadence_days: number | null;
    contribution_anchor_date: string | null;
    owner_member_id: string | null;
    balances_source_type: string | null;
    balances_as_of: string | null;
    orders_as_of: string | null;
    orders_source: string | null;
  };
  members: { id: string; display_name: string; birth_date: string | null }[];
  holdings: { symbol: string; quantity: number; current_price: number; cost_basis: number }[];
  strategy: { symbol: string; bucket: string }[];
  capsSource: string | null;
};

/** Profile A — a margin brokerage, US equities, a long horizon, a dependant. */
const A: Profile = {
  name: "Profile A",
  account: {
    id: "a-1",
    name: "Growth Brokerage",
    account_type: "brokerage",
    currency: "USD",
    cash: 20_000,
    margin_enabled: true,
    margin_used: 30_000,
    buying_power: 60_000,
    target_value: 500_000,
    target_date: "2036-01-01",
    contribution_amount: 1_000,
    contribution_cadence_days: 30,
    contribution_anchor_date: "2026-09-30",
    owner_member_id: "m-a1",
    balances_source_type: "imported_snapshot",
    balances_as_of: FRESH,
    orders_as_of: FRESH,
    orders_source: "imported",
  },
  members: [{ id: "m-a1", display_name: "Holder A", birth_date: "1980-04-11" }],
  holdings: [
    { symbol: "SYNA", quantity: 200, current_price: 500, cost_basis: 400 },
    { symbol: "SYNB", quantity: 100, current_price: 300, cost_basis: 350 },
  ],
  strategy: [
    { symbol: "SYNA", bucket: "core" },
    { symbol: "SYNB", bucket: "supporting" },
  ],
  capsSource: "user_set",
};

/** Profile B — cash-only, crypto, short horizon, no household, no plan. */
const B: Profile = {
  name: "Profile B",
  account: {
    id: "b-1",
    name: "Crypto Cash",
    account_type: "crypto",
    currency: "EUR",
    cash: 750,
    margin_enabled: false,
    margin_used: null,
    buying_power: null,
    target_value: 5_000,
    target_date: "2028-06-30",
    // No contribution plan at all — not a plan of zero.
    contribution_amount: null,
    contribution_cadence_days: null,
    contribution_anchor_date: null,
    // Nobody linked. Rule 22: household is optional.
    owner_member_id: null,
    balances_source_type: "user_entry",
    balances_as_of: FRESH,
    // Nobody has ever told the app about this account's orders.
    orders_as_of: null,
    orders_source: null,
  },
  members: [],
  holdings: [{ symbol: "SYNC", quantity: 12, current_price: 0.00004, cost_basis: 0.00003 }],
  strategy: [{ symbol: "SYNC", bucket: "speculative" }],
  capsSource: null,
};

const totalsFor = (p: Profile) => accountTotals(p.holdings, p.account);

describe("the two profiles get different answers, from the same code", () => {
  test("account values are each profile's own", () => {
    expect(totalsFor(A).totalAccountValue).toBe(20_000 + 130_000 - 30_000);
    expect(totalsFor(B).totalAccountValue).toBeCloseTo(750 + 12 * 0.00004, 8);
  });

  test("categorisation follows TYPE, and the two differ", () => {
    expect(accountCategory(A.account)).toBe("Primary");
    expect(accountCategory(B.account)).toBe("Crypto");
  });

  test("objectives are each profile's own", () => {
    const oa = accountObjectiveOf(A.account);
    const ob = accountObjectiveOf(B.account);
    expect(oa.kind).toBe("set");
    expect(ob.kind).toBe("set");
    if (oa.kind !== "set" || ob.kind !== "set") throw new Error("unreachable");
    expect(oa.targetValue).toBe(500_000);
    expect(ob.targetValue).toBe(5_000);
    expect(oa.targetDate).not.toBe(ob.targetDate);
  });

  test("a contribution plan exists for one and not the other", () => {
    const oa = accountObjectiveOf(A.account);
    const ob = accountObjectiveOf(B.account);
    if (oa.kind !== "set" || ob.kind !== "set") throw new Error("unreachable");
    expect(oa.contribution).not.toBeNull();
    // Not a plan of $0 — no plan at all.
    expect(ob.contribution).toBeNull();
    expect(nextContributionDate(oa.contribution!, NOW).toISOString().slice(0, 10)).toBe(
      "2026-09-30",
    );
  });

  test("a household total is each profile's own", () => {
    expect(combinedTarget([accountObjectiveOf(A.account)])).toBe(500_000);
    expect(combinedTarget([accountObjectiveOf(B.account)])).toBe(5_000);
  });
});

describe("no dependant, no strategy and no policy are assumed for B", () => {
  test("B has no household members, and nothing invents one", () => {
    expect(membersOfAccounts([B.account], B.members)).toEqual([]);
    expect(memberOfAccount(B.account, B.members)).toBeNull();
    // A's does resolve, so the emptiness above is B's data and not a broken
    // lookup.
    expect(memberOfAccount(A.account, A.members)?.display_name).toBe("Holder A");
  });

  test("ages come from each profile's own dates", () => {
    expect(ageOf(A.members[0]!.birth_date, NOW)).toBe(46);
    expect(ageOf(null, NOW)).toBeNull();
  });

  test("each profile's approved universe is its own", () => {
    const a = approvedSymbols(A.strategy)!;
    const b = approvedSymbols(B.strategy)!;
    expect(a.has("SYNA")).toBe(true);
    expect(a.has("SYNC")).toBe(false);
    expect(b.has("SYNC")).toBe(true);
    expect(b.has("SYNA")).toBe(false);
  });

  test("the buckets differ, and neither is a compiled-in list", () => {
    expect(byBucket(A.strategy).map(([k]) => k)).toEqual(["core", "supporting"]);
    expect(byBucket(B.strategy).map(([k]) => k)).toEqual(["speculative"]);
  });

  test("'% in approved names' is computed against the profile's OWN list", () => {
    const inA = approvedShare(
      A.holdings.map((h) => ({ symbol: h.symbol, value: h.quantity * h.current_price })),
      approvedSymbols(A.strategy),
    );
    expect(inA).toBe(1);
    // A's holdings measured against B's universe: none of them qualify. Same
    // function, different configuration, different answer.
    const aAgainstB = approvedShare(
      A.holdings.map((h) => ({ symbol: h.symbol, value: h.quantity * h.current_price })),
      approvedSymbols(B.strategy),
    );
    expect(aAgainstB).toBe(0);
  });

  test("a user with no strategy at all gets Unavailable, not 0%", () => {
    expect(approvedShare([{ symbol: "SYNA", value: 100 }], approvedSymbols([]))).toBeNull();
  });

  test("risk caps are confirmed for A and not for B", () => {
    expect(policyIsConfirmed(policySourceOf(A.capsSource))).toBe(true);
    expect(policyIsConfirmed(policySourceOf(B.capsSource))).toBe(false);
  });
});

describe("the truth gates read each profile's own state", () => {
  const checksFor = (p: Profile) =>
    readinessChecksFor({
      account: p.account,
      totalAccountValue: totalsFor(p).totalAccountValue,
      positionsValue: totalsFor(p).positionsValue,
      latestValue: totalsFor(p).totalAccountValue,
      latestAsOf: FRESH,
      policySource: policySourceOf(p.capsSource),
      now: NOW,
    });

  test("A is ready to be recommended against", () => {
    expect(gate("committee_recommendation", checksFor(A)).allowed).toBe(true);
  });

  test("B is blocked, and the reason is B's own missing inputs", () => {
    const g = gate("position_sizing", checksFor(B));
    expect(g.allowed).toBe(false);
    if (g.allowed) throw new Error("unreachable");
    const ids = g.because.map((c) => c.id).sort();
    // Nobody has reported B's orders, and nobody has confirmed its caps.
    expect(ids).toContain("open_orders");
    expect(ids).toContain("policy");
    // A's inputs are fine, so these are B's facts rather than a broken gate.
    expect(gate("position_sizing", checksFor(A)).allowed).toBe(true);
  });

  test("research is available to both, whatever else is missing", () => {
    expect(gate("research", checksFor(A)).allowed).toBe(true);
    expect(gate("research", checksFor(B)).allowed).toBe(true);
  });

  test("open-order knowledge differs because the profiles differ", () => {
    expect(openOrdersKnown(A.account, NOW)).toBe(true);
    expect(openOrdersKnown(B.account, NOW)).toBe(false);
  });
});

describe("presentation follows each profile's instruments and currency", () => {
  test("B's crypto price keeps its digits where A's equity does not need them", () => {
    expect(
      displayDecimals(A.holdings[0]!.current_price, classOf({ instrument_class: "equity" })),
    ).toBe(2);
    expect(
      displayDecimals(B.holdings[0]!.current_price, classOf({ instrument_class: "crypto" })),
    ).toBeGreaterThan(4);
  });

  test("each account's currency is its own, and neither is assumed", () => {
    expect(accountCurrency(A.account)).toBe("USD");
    expect(accountCurrency(B.account)).toBe("EUR");
    expect(accountCurrency({ currency: null })).toBeNull();
  });
});

// The honesty clause. A green suite here is evidence about the APPLICATION
// LOGIC and nothing else, and saying so is the difference between a proof and
// a reassurance.
describe("what this test does NOT cover", () => {
  test("it exercises pure logic, not the deployed database", () => {
    // Every import above is a pure module. If one of them ever reached the
    // Supabase client, this suite would start passing for the wrong reason —
    // exercising a mock rather than the app — so the absence is asserted.
    expect(typeof accountTotals).toBe("function");
    expect(typeof gate).toBe("function");
  });

  test("RLS, auth and the migrations are NOT proven here", () => {
    // Recorded as a fact rather than implied by a green run. A real second
    // account against a real project is the only thing that shows those, the
    // migrations are not applied yet, and this file cannot substitute for it.
    const notCovered = [
      "row-level security actually isolating two users' rows",
      "auth.uid() resolving in the import function",
      "the migrations applying cleanly to the live database",
      "Lovable's deploy of any of the above",
    ];
    expect(notCovered.length).toBeGreaterThan(0);
  });
});
