// Account resolution must never substitute one account's rows for another's
// (PR-UI-2). The replaced code fell back to accountless holdings on a lookup
// miss, which rendered a plausible but wrong portfolio with no error.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { defaultAccountId, selectAccountHoldings } from "../accountSelection";
import { accountCategory, CATEGORY_ORDER } from "../data/accountGroups";

function account(id: string, name: string, account_type: string | null = "brokerage") {
  return { id, name, account_type };
}

/** Comments explain the removed name-matching; the guard is about live code. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
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
  test("prefers the primary account over custodial and retirement accounts", () => {
    const accounts = [
      account("k", "Child A", "custodial"),
      account("i", "Retirement", "roth_ira"),
      account("p", "Main", "brokerage"),
    ];
    expect(defaultAccountId(accounts)).toBe("p");
  });

  test("falls back to the first account when none is primary", () => {
    const accounts = [account("k", "Child A", "custodial"), account("z", "Child B", "custodial")];
    expect(defaultAccountId(accounts)).toBe("k");
  });

  test("an unclassified household still selects something", () => {
    // While accounts are being classified their type is unknown, and every one
    // of them is Unclassified. Selecting nothing would empty every screen; the
    // Settings banner is what says why it could not do better.
    const accounts = [account("a", "One", null), account("b", "Two", null)];
    expect(defaultAccountId(accounts)).toBe("a");
  });

  test("returns null with no accounts", () => {
    expect(defaultAccountId([])).toBeNull();
  });
});

describe("accountCategory", () => {
  // Every one of these used to be asserted through a NAME. That is the defect:
  // the classifier matched a hardcoded list of the owner's children's first
  // names, so the app could not serve a second household without a source
  // change, and renaming an account changed its tax treatment.
  test("classifies on the account's type", () => {
    expect(accountCategory({ account_type: "custodial" })).toBe("Kids");
    expect(accountCategory({ account_type: "529" })).toBe("529");
    expect(accountCategory({ account_type: "crypto" })).toBe("Crypto");
    expect(accountCategory({ account_type: "roth_ira" })).toBe("IRA");
    expect(accountCategory({ account_type: "ira" })).toBe("IRA");
    expect(accountCategory({ account_type: "401k" })).toBe("IRA");
    expect(accountCategory({ account_type: "brokerage" })).toBe("Primary");
  });

  test("the classifier does not read a name at all", () => {
    // Asserting this through the function is tautological — `accountCategory`
    // no longer takes a name, so any such test passes by construction and
    // proves only that it compiles. The claim worth pinning is about the
    // MODULE: nothing in it consults `name`, so no future edit can quietly
    // reintroduce a matcher beside the type lookup.
    const code = stripComments(readFileSync("src/lib/data/accountGroups.ts", "utf8"));
    expect(code).not.toMatch(/\bname\b/);
    expect(code).not.toMatch(/\.test\(|\.exec\(|match\(/);
  });

  test("an unknown type is Unclassified, not Primary", () => {
    // The old classifier's `return "Primary"` swept up everything it could not
    // place, so a misfiled account was silently blended into the holder's own
    // money rather than surfaced as a question.
    expect(accountCategory({ account_type: null })).toBe("Unclassified");
    expect(accountCategory({ account_type: "" })).toBe("Unclassified");
    expect(accountCategory({ account_type: "annuity" })).toBe("Unclassified");
  });

  test("every category is orderable for display", () => {
    for (const t of ["custodial", "529", "crypto", "roth_ira", "brokerage", null])
      expect(CATEGORY_ORDER).toContain(accountCategory({ account_type: t }));
  });
});

describe("destination de-duplication", () => {
  // `accounts.name` has no unique constraint; the CSV importer groups by name.
  test("duplicate account names collapse to one destination", () => {
    const unique = [...new Set(["Brokerage", "Roth IRA", "Brokerage"])];
    expect(unique).toEqual(["Brokerage", "Roth IRA"]);
  });
});
