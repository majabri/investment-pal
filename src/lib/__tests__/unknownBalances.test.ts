// Rule 13 at the two layers Phase 1a changed: how an unknown balance is
// aggregated, and how it is rendered.
//
// `accounts.cash / margin_used / margin_limit / buying_power` were
// `NOT NULL DEFAULT 0`, so "we were never told" was inexpressible. Dropping the
// constraint is only half the fix — the other half is that nothing downstream
// may quietly turn the resulting NULL back into a number.
import { describe, expect, test } from "bun:test";

import { sumField, type BalanceFields } from "../accountAggregate";
import {
  marginInterestFigure,
  interestProvenance,
  interestProvenanceShort,
  type MarginPolicy,
} from "../marginCost";
import { UNAVAILABLE, usdOrUnavailable, pctOrUnavailable } from "../unavailable";
import {
  buildV5Prompt,
  buildV6Prompt,
  buildUniversalPrompt,
  buildMorningPrompt,
  buildEODPrompt,
  buildWeeklyPrompt,
  buildMiddayPrompt,
  type PromptContext,
} from "../prompts";

const account = (over: Partial<BalanceFields>): BalanceFields => ({
  cash: 100,
  margin_used: 0,
  margin_limit: 0,
  buying_power: 0,
  ...over,
});

describe("summing across accounts", () => {
  test("adds the values when every account knows its own", () => {
    expect(sumField([account({ cash: 100 }), account({ cash: 250 })], "cash")).toBe(350);
  });

  test("a real zero contributes zero and does not make the total unknown", () => {
    expect(sumField([account({ cash: 100 }), account({ cash: 0 })], "cash")).toBe(100);
  });

  test("one unknown account makes the whole total unknown", () => {
    // This used to coerce with `|| 0` and report 100 — the other accounts'
    // total, presented as the household's, wrong by exactly the amount nobody
    // supplied. "Sum of the accounts that happen to have data" is not a
    // household total and there is no way to render it that does not read as
    // one.
    expect(sumField([account({ cash: 100 }), account({ cash: null })], "cash")).toBeNull();
  });

  test("an empty set of accounts is zero, not unknown", () => {
    // Nothing to add is a known fact; it is the missing FIGURE that is unknown.
    expect(sumField([], "cash")).toBe(0);
  });

  test("every money field behaves the same way", () => {
    for (const key of ["cash", "margin_used", "margin_limit", "buying_power"] as const) {
      expect(sumField([account({ [key]: null })], key)).toBeNull();
    }
  });
});

describe("margin interest when the loan size is unknown", () => {
  const policy: MarginPolicy = {
    margin_rate_annual_pct: 9.75,
    margin_rate_as_of: "2026-09-01",
    margin_rate_is_floating: false,
    margin_rate_stale_days: 90,
  };

  test("no estimate is produced from an unknown loan", () => {
    // The direction matters: coercing to 0 returns "$0.00/day", a cost of
    // borrowing stated as nil, which is the direction that flatters a decision
    // to borrow.
    const f = marginInterestFigure({ accruedMtd: null, marginUsed: null, policy });
    expect(f.kind).toBe("unavailable");
    expect(f.kind === "unavailable" && f.reason).toBe("margin-loan-unknown");
  });

  test("it says the loan is unknown, not that the rate is unset", () => {
    // An unset rate is a different and fixable problem; naming it would send
    // the user to Settings to fix something that would not help.
    const f = marginInterestFigure({ accruedMtd: null, marginUsed: null, policy });
    expect(interestProvenance(f)).toContain("margin loan is not known");
    expect(interestProvenanceShort(f)).toBe("loan not known");
  });

  test("a known zero loan still estimates zero, because that is a real answer", () => {
    const f = marginInterestFigure({ accruedMtd: null, marginUsed: 0, policy });
    expect(f.kind).toBe("estimate");
  });

  test("an observed accrued figure still wins, even with an unknown loan", () => {
    // Observed beats computed unconditionally. An unknown loan size does not
    // invalidate a figure the broker actually reported.
    const f = marginInterestFigure({ accruedMtd: 42.5, marginUsed: null, policy });
    expect(f.kind).toBe("actual");
  });
});

describe("rendering a figure the app does not have", () => {
  test("unknown renders as a word, not as a number", () => {
    expect(usdOrUnavailable(null)).toBe(UNAVAILABLE);
    expect(usdOrUnavailable(undefined)).toBe(UNAVAILABLE);
    expect(usdOrUnavailable(Number.NaN)).toBe(UNAVAILABLE);
    expect(pctOrUnavailable(null)).toBe(UNAVAILABLE);
  });

  test("a real zero still renders as a zero", () => {
    expect(usdOrUnavailable(0)).toBe("$0.00");
    expect(pctOrUnavailable(0)).toBe("0.0%");
  });

  test("the word is not a dash, because a dash already means something else", () => {
    // "—" means NO SCOPE: no account is selected. UNAVAILABLE means an account
    // is selected and the figure is not known. Collapsing them loses which
    // action fixes it.
    expect(UNAVAILABLE).not.toBe("—");
  });
});

// The committee prompt is the highest-stakes renderer of an unknown balance.
// The figures below sit inside a block headed "MY VERIFIED DATA — GROUND EVERY
// RECOMMENDATION ONLY IN THIS", so a fabricated $0.00 is not a display defect:
// it is a false premise the model is instructed to reason from, and position
// sizing is expressed as a percentage of exactly these numbers.
describe("an unknown balance reaches the committee as unknown", () => {
  const base: PromptContext = {
    accountName: "Growth Brokerage",
    portfolioValue: null,
    grossValue: null,
    cash: null,
    marginUsed: null,
    buyingPower: null,
    todaysPL: 120,
    todaysPLPct: null,
    objective: { kind: "unset", missing: [] },
    requiredCagr: null,
    probability: null,
    holdings: [{ symbol: "ABC", quantity: 10, costBasis: 5, currentPrice: 8 }],
    priorities: [],
    userNotes: "",
  };

  const builders: Array<[string, (c: PromptContext) => string]> = [
    ["v6", (c) => buildV6Prompt({ ...c, meeting: "Morning" })],
    ["v5", (c) => buildV5Prompt({ ...c, meeting: "Morning" })],
    ["universal", (c) => buildUniversalPrompt({ ...c, meeting: "Morning" })],
    ["morning", buildMorningPrompt],
    ["eod", (c) => buildEODPrompt({ ...c, tradesToday: "(none)" })],
    ["weekly", buildWeeklyPrompt],
    ["midday", buildMiddayPrompt],
  ];

  for (const [name, build] of builders) {
    test(`${name}: says NOT KNOWN rather than $0.00`, () => {
      const out = build(base);
      expect(out).toContain("Cash: NOT KNOWN | Margin used: NOT KNOWN | Buying power: NOT KNOWN");
      expect(out).toContain("Account value (NET, investments + cash − margin): NOT KNOWN");
      expect(out).not.toContain("Cash: $0.00");
      expect(out).not.toContain("Margin used: $0.00");
    });

    test(`${name}: states no concentration it cannot compute`, () => {
      // Every position read "0.0% of acct", which tells the committee that
      // nothing breaches the position cap — a governance conclusion drawn from
      // an account value nobody supplied.
      const out = build(base);
      expect(out).toContain("(NOT KNOWN of acct)");
      expect(out).not.toContain("(0.0% of acct)");
    });

    test(`${name}: known balances still render as figures`, () => {
      // The unknown path must not swallow the normal one.
      const out = build({
        ...base,
        portfolioValue: 80_000,
        grossValue: 100_000,
        cash: 2_500,
        marginUsed: 20_000,
        buyingPower: 5_000,
        todaysPLPct: 0.0015,
      });
      expect(out).toContain("Cash: $2,500.00 | Margin used: $20,000.00 | Buying power: $5,000.00");
      expect(out).not.toContain("NOT KNOWN of acct");
      expect(out).toContain("Account equity: 80.0%");
    });

    test(`${name}: a real zero balance still renders as zero`, () => {
      // The distinction is the point. If 0 also became NOT KNOWN, the fix would
      // have destroyed the other half of it.
      const out = build({
        ...base,
        portfolioValue: 100_000,
        grossValue: 100_000,
        cash: 0,
        marginUsed: 0,
        buyingPower: 0,
      });
      expect(out).toContain("Cash: $0.00 | Margin used: $0.00 | Buying power: $0.00");
    });
  }
});
