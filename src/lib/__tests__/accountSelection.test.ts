// Account resolution must never substitute one account's rows for another's
// (PR-UI-2). The replaced code fell back to accountless holdings on a lookup
// miss, which rendered a plausible but wrong portfolio with no error.
import { describe, expect, test } from "bun:test";

import { defaultAccountId, selectAccountHoldings } from "../accountSelection";
import { accountCategory, CATEGORY_ORDER } from "../data/accountGroups";

function account(id: string, name: string) {
  return { id, name };
}

const holdings = [
  { account_id: "a1", symbol: "AAA" },
  { account_id: "a2", symbol: "BBB" },
  { account_id: null, symbol: "MANUAL" },
];

describe("selectAccountHoldings", () => {
  test("returns only the selected account's rows", () => {
    expect(selectAccountHoldings(holdings, "a1").map((h) => h.symbol)).toEqual(["AAA"]);
  });

  test("optionally includes accountless manual adds", () => {
    expect(
      selectAccountHoldings(holdings, "a1", { includeUnassigned: true }).map((h) => h.symbol),
    ).toEqual(["AAA", "MANUAL"]);
  });

  test("returns nothing when no account is resolved — never the accountless rows", () => {
    expect(selectAccountHoldings(holdings, null)).toEqual([]);
    expect(selectAccountHoldings(holdings, null, { includeUnassigned: true })).toEqual([]);
  });

  test("an unknown account id yields nothing rather than another account's money", () => {
    expect(selectAccountHoldings(holdings, "does-not-exist")).toEqual([]);
  });
});

describe("defaultAccountId", () => {
  test("prefers the primary account over kids and retirement accounts", () => {
    const accounts = [account("k", "Karim"), account("i", "Roth IRA"), account("p", "Brokerage")];
    expect(defaultAccountId(accounts)).toBe("p");
  });

  test("falls back to the first account when none is primary", () => {
    const accounts = [account("k", "Karim"), account("z", "Zain")];
    expect(defaultAccountId(accounts)).toBe("k");
  });

  test("returns null with no accounts", () => {
    expect(defaultAccountId([])).toBeNull();
  });
});

describe("accountCategory", () => {
  test("classifies by account shape, not by a specific account name", () => {
    expect(accountCategory("Karim")).toBe("Kids");
    expect(accountCategory("Jude 529")).toBe("529");
    expect(accountCategory("Zain Crypto")).toBe("Crypto");
    expect(accountCategory("ROTH IRA")).toBe("IRA");
  });

  test("any ordinary brokerage name is the holder's primary account", () => {
    // The point of the change: renaming the account must not reclassify it.
    expect(accountCategory("Amir - TOD")).toBe("Primary");
    expect(accountCategory("Individual - TOD")).toBe("Primary");
    expect(accountCategory("Brokerage")).toBe("Primary");
  });

  test("every category is orderable for display", () => {
    for (const name of ["Karim", "Jude 529", "Zain Crypto", "ROTH IRA", "Brokerage"]) {
      expect(CATEGORY_ORDER).toContain(accountCategory(name));
    }
  });
});
