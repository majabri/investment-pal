// Phase 6, rule 29: import safety.
//
// "Account-scoped, validated, previewed, atomic, auditable, idempotent where
// appropriate. An import to one account must not touch another. A failed
// import must not leave half-written financial data. Theses, notes, decisions
// and history must survive a position refresh."
//
// The Portfolio CSV import violated three of those, and the last is silent
// data loss that has been shipping:
//
//   1. NOT ATOMIC — DELETE-then-INSERT per account in the client, no
//      transaction. A failure between them left that account with NO
//      POSITIONS and every later account untouched.
//   2. THESES DID NOT SURVIVE — the delete dropped `original_thesis`,
//      `current_thesis`, `why_own`, `notes`, `sector`, `last_ai_review` and
//      `last_reviewed_at` for every symbol, on every import.
//   3. UNKNOWN CASH WAS WRITTEN AS ZERO — `cashByAccount[label] ?? 0`, where
//      the parser only creates a key when the CSV carried a cash line.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  IMPORTED_COLUMNS,
  NARRATIVE_COLUMNS,
  accountsInScope,
  cashForAccount,
  isDestructive,
  previewImport,
} from "../importSafety";

describe("cashForAccount", () => {
  test("sums the labels that fed this account", () => {
    expect(cashForAccount(["A", "B"], { A: 100, B: 50 })).toBe(150);
  });

  test("a label with no cash line makes the figure UNKNOWN, not zero", () => {
    // The Phase 1a defect, in the path that writes money most often. Two
    // known figures plus one missing is not the account's cash — it is a
    // number short by whatever the third was.
    expect(cashForAccount(["A", "B"], { A: 100 })).toBeNull();
  });

  test("no labels is unknown", () => {
    expect(cashForAccount([], { A: 100 })).toBeNull();
  });

  test("a real zero survives", () => {
    // A CSV that says the cash balance is $0.00 is stating a fact, and it
    // must not be swept up with the missing case.
    expect(cashForAccount(["A"], { A: 0 })).toBe(0);
  });

  test("NaN is not a figure", () => {
    expect(cashForAccount(["A"], { A: NaN })).toBeNull();
  });

  test("NEGATIVE CONTROL: a complete set gives a number", () => {
    expect(typeof cashForAccount(["A"], { A: 12.5 })).toBe("number");
  });
});

describe("previewImport", () => {
  const rows = (...syms: string[]) =>
    syms.map((s) => ({ symbol: s, quantity: 1, cost_basis: 1, current_price: 1 }));

  test("names what is added, updated and REMOVED", () => {
    // "Removed" is the word that earns the preview: added and updated rows
    // are visible in the file the user just chose, the disappearing ones are
    // not — and a mis-mapped account is how a portfolio gets emptied by a
    // correct-looking import.
    const p = previewImport("a1", "Brokerage", rows("MSFT", "NVDA"), ["MSFT", "TSLA"], 100);
    expect(p.added).toEqual(["NVDA"]);
    expect(p.updated).toEqual(["MSFT"]);
    expect(p.removed).toEqual(["TSLA"]);
  });

  test("symbol case does not create phantom adds and removes", () => {
    const p = previewImport("a1", "Brokerage", rows("msft"), ["MSFT"], null);
    expect(p.added).toEqual([]);
    expect(p.removed).toEqual([]);
    expect(p.updated).toEqual(["MSFT"]);
  });

  test("an unknown cash figure is carried through as null", () => {
    expect(previewImport("a1", "B", rows("MSFT"), [], null).cash).toBeNull();
  });
});

describe("isDestructive", () => {
  const preview = (updated: string[], removed: string[]) =>
    previewImport(
      "a1",
      "B",
      updated.map((s) => ({ symbol: s, quantity: 1, cost_basis: 1, current_price: 1 })),
      [...updated, ...removed],
      null,
    );

  test("removing nothing is not destructive", () => {
    expect(isDestructive(preview(["MSFT"], []))).toBe(false);
  });

  test("emptying an account is destructive at ANY size", () => {
    // Rule 31: a count threshold would wave through a 4-position account
    // being emptied while nagging a 300-position one.
    expect(isDestructive(preview([], ["MSFT"]))).toBe(true);
    expect(isDestructive(preview([], ["A", "B", "C", "D", "E", "F"]))).toBe(true);
  });

  test("a proportion, not a count", () => {
    // 2 removed of 100 held: routine. 2 removed of 4 held: worth confirming.
    const many = preview(
      Array.from({ length: 98 }, (_, i) => `S${i}`),
      ["X", "Y"],
    );
    expect(isDestructive(many)).toBe(false);
    expect(isDestructive(preview(["A", "B"], ["X", "Y"]))).toBe(true);
  });
});

describe("accountsInScope", () => {
  test("only the mapped destinations, deduplicated", () => {
    const { scoped, skipped } = accountsInScope(["a1", "a2", "a1", null]);
    expect(scoped.sort()).toEqual(["a1", "a2"]);
    expect(skipped).toBe(1);
  });

  test("skipping everything writes nothing", () => {
    expect(accountsInScope([null, null]).scoped).toEqual([]);
  });
});

// The atomicity and the preservation can only be promised by the database.
// These assert the function says what this module claims it says.
describe("the import function keeps its promises", () => {
  const sql = readFileSync("supabase/migrations/20260905300000_import_safety.sql", "utf8");
  // Everything from the UPDATE keyword to the end of its SET list.
  const setList = sql.slice(sql.indexOf("UPDATE public.holdings"), sql.indexOf("WHERE user_id    = v_user"));

  test("no narrative column is written by the position update", () => {
    // The whole reason it is UPDATE-then-INSERT rather than
    // DELETE-then-INSERT: these columns are simply not in the SET list, so
    // they survive untouched.
    for (const col of NARRATIVE_COLUMNS) {
      expect(setList).not.toContain(`${col} `);
      expect(setList).not.toContain(`${col}=`);
    }
  });

  test("every imported column IS written", () => {
    // The other half. Without this the test above would pass on a function
    // that wrote nothing at all.
    for (const col of IMPORTED_COLUMNS) expect(setList).toContain(col);
  });

  test("NEGATIVE CONTROL: the slice really is the SET list", () => {
    expect(setList).toContain("SET");
    expect(setList).toContain("quantity");
    expect(setList.length).toBeLessThan(sql.length / 2);
  });

  test("the delete is scoped to one account", () => {
    // Rule 29's "an import to one account must not touch another", which the
    // old client-side `fullOverwrite` broke by deleting every holding the
    // user had.
    expect(sql).toContain("DELETE FROM public.holdings");
    const del = sql.slice(sql.indexOf("DELETE FROM public.holdings"));
    expect(del).toContain("account_id = p_account_id");
    expect(del).toContain("user_id    = v_user");
  });

  test("it refuses an account belonging to somebody else", () => {
    expect(sql).toContain("does not belong to the signed-in user");
  });

  test("a NULL cash argument leaves the column alone", () => {
    // Not zero, and not NULL either — writing NULL would erase a figure the
    // user may have entered by hand.
    expect(sql).toContain("COALESCE(p_cash, cash)");
  });

  test("it returns what it did, for the toast and the log", () => {
    // "Auditable" (rule 29). The removals are the part the user cannot see in
    // the file they chose.
    for (const k of ["updated", "inserted", "removed", "cash_written"]) {
      expect(sql).toContain(`'${k}'`);
    }
  });
});

describe("the client no longer writes positions directly", () => {
  const src = readFileSync("src/components/app/PortfolioCsvImport.tsx", "utf8");

  test("it calls the atomic function", () => {
    expect(src).toContain("import_account_positions");
  });

  test("no delete-then-insert on holdings survives", () => {
    // The shape of the defect: a client-side delete of holdings, with no
    // transaction around the insert that was meant to follow it.
    expect(src).not.toMatch(/from\("holdings"\)[\s\S]{0,40}\.delete\(/);
    expect(src).not.toMatch(/from\("holdings"\)[\s\S]{0,40}\.insert\(/);
  });

  test("NEGATIVE CONTROL: those patterns match the code that was removed", () => {
    expect(`supabase.from("holdings").delete().eq("account_id", id)`).toMatch(
      /from\("holdings"\)[\s\S]{0,40}\.delete\(/,
    );
    expect(`supabase.from("holdings").insert(rows)`).toMatch(
      /from\("holdings"\)[\s\S]{0,40}\.insert\(/,
    );
  });

  test("the user-wide overwrite switch is gone", () => {
    // It defaulted to ON and deleted every holding the user had.
    expect(src).not.toContain("fullOverwrite");
  });

  test("unknown cash is passed as null, not summed with ?? 0", () => {
    expect(src).toContain("cashForAccount(");
    expect(src).not.toMatch(/cashByAccount\[\w+\]\s*\?\?\s*0/);
  });

  test("NEGATIVE CONTROL: that pattern matches the line that was removed", () => {
    expect(`(c, label) => c + (cashByAccount[label] ?? 0)`).toMatch(
      /cashByAccount\[\w+\]\s*\?\?\s*0/,
    );
  });
});
