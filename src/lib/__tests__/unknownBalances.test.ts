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
import {
  UNAVAILABLE,
  numberOrUnknown,
  usdOrUnavailable,
  pctOrUnavailable,
} from "../unavailable";

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

describe("what a number box means when the figure may be unknown", () => {
  test("an emptied box is unknown, not zero", () => {
    // Writing 0 here would say "this account has no cash" on the user's behalf.
    expect(numberOrUnknown("")).toBeNull();
    expect(numberOrUnknown("   ")).toBeNull();
  });

  test("a half-typed value is unknown, not NaN", () => {
    // `<input type="number">` permits each of these mid-entry, and NaN in a
    // NUMERIC column is neither a figure nor an honest absence.
    for (const partial of ["-", ".", "-.", "1e", "e5", "abc"]) {
      expect(numberOrUnknown(partial)).toBeNull();
    }
  });

  test("a typed zero is a real zero, because the user typed it", () => {
    expect(numberOrUnknown("0")).toBe(0);
    expect(numberOrUnknown("0.00")).toBe(0);
  });

  test("ordinary figures survive, negatives included", () => {
    expect(numberOrUnknown("23119.31")).toBe(23_119.31);
    expect(numberOrUnknown("-12.5")).toBe(-12.5);
  });
});
