// A tranche as typed, the row it becomes, and the one change it takes later
// (§12.4, BR-010).
//
// The property worth most here is the last describe: every rule this
// validator applies is a clause of the schema's CHECK. There is no TypeScript
// authority for tranches the way `fillRejection` is for fills, so the
// migration is read and each rule is pinned to the clause it restates.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  canCloseTranche,
  canOpenTranche,
  closeRejection,
  emptyTrancheDraft,
  normaliseSymbol,
  trancheClosePatch,
  trancheInsert,
  validateTrancheDraft,
} from "@/lib/trancheDraft";
import type { TrancheDraft } from "@/lib/trancheDraft";

// A fixed "now", so nothing here depends on the clock.
const NOW = new Date(2026, 8, 17, 15, 30); // 2026-09-17 15:30 local
const PAST = "2026-09-17T09:00";

const draft = (over: Partial<TrancheDraft> = {}): TrancheDraft => ({
  symbol: "AAA",
  kind: "tactical",
  openedAt: PAST,
  quantity: 10,
  target: null,
  invalidation: null,
  note: null,
  ...over,
});

const fields = (d: TrancheDraft) => validateTrancheDraft(d, NOW).map((p) => p.field);

describe("validateTrancheDraft", () => {
  test("NEGATIVE CONTROL: a complete draft has no problems", () => {
    expect(validateTrancheDraft(draft(), NOW)).toEqual([]);
    expect(canOpenTranche(draft(), NOW)).toBe(true);
  });

  test("an empty draft names every required box, and only those", () => {
    expect(fields(emptyTrancheDraft("", NOW))).toEqual(["symbol", "kind", "quantity"]);
  });

  test("a blank or whitespace symbol is refused", () => {
    expect(fields(draft({ symbol: "   " }))).toEqual(["symbol"]);
  });

  test("the kind must be chosen — there is no default", () => {
    expect(fields(draft({ kind: null }))).toEqual(["kind"]);
    expect(validateTrancheDraft(draft({ kind: null }), NOW)[0].message).toContain("close separately");
  });

  test("a kind outside the schema's two is refused, whatever the compiler was told", () => {
    expect(fields(draft({ kind: "speculative" as unknown as "core" }))).toEqual(["kind"]);
  });

  test("opened-at must be a real local minute, and not in the future", () => {
    expect(fields(draft({ openedAt: "" }))).toEqual(["openedAt"]);
    expect(fields(draft({ openedAt: "2026-02-31T10:00" }))).toEqual(["openedAt"]);
    expect(fields(draft({ openedAt: "2026-09-17T15:31" }))).toEqual(["openedAt"]);
    expect(fields(draft({ openedAt: "2026-09-17T15:30" }))).toEqual([]);
  });

  test("quantity must be a positive finite number", () => {
    expect(fields(draft({ quantity: null }))).toEqual(["quantity"]);
    expect(fields(draft({ quantity: 0 }))).toEqual(["quantity"]);
    expect(fields(draft({ quantity: -5 }))).toEqual(["quantity"]);
    expect(fields(draft({ quantity: Number.NaN }))).toEqual(["quantity"]);
    expect(fields(draft({ quantity: 0.5 }))).toEqual([]);
  });

  test("a target is optional, but if given it is a positive price", () => {
    expect(fields(draft({ target: null }))).toEqual([]);
    expect(fields(draft({ target: 120 }))).toEqual([]);
    expect(fields(draft({ target: 0 }))).toEqual(["target"]);
    expect(fields(draft({ target: -1 }))).toEqual(["target"]);
    expect(fields(draft({ target: Number.POSITIVE_INFINITY }))).toEqual(["target"]);
  });

  test("several problems are all named, not just the first", () => {
    expect(fields(draft({ symbol: "", kind: null, quantity: 0, target: 0 }))).toEqual([
      "symbol",
      "kind",
      "quantity",
      "target",
    ]);
  });
});

describe("trancheInsert", () => {
  test("builds the row, with the symbol normalised and the minute made an instant", () => {
    const row = trancheInsert({
      userId: "u1",
      accountId: "a1",
      draft: draft({ symbol: " aaa ", target: 120, invalidation: "  breaks 90 ", note: "" }),
    });
    expect(row.user_id).toBe("u1");
    expect(row.account_id).toBe("a1");
    expect(row.symbol).toBe("AAA");
    expect(row.kind).toBe("tactical");
    expect(row.opened_at).toBe(new Date(PAST).toISOString());
    expect(row.opened_quantity).toBe(10);
    expect(row.target).toBe(120);
    expect(row.invalidation).toBe("breaks 90");
    // An empty note is NULL, not "".
    expect(row.note).toBeNull();
    expect(row.closed_at).toBeNull();
  });

  test("the decision and security links are explicitly null — not offered yet, not guessed", () => {
    const row = trancheInsert({ userId: "u", accountId: "a", draft: draft() });
    expect(row.decision_id).toBeNull();
    expect(row.security_id).toBeNull();
  });

  test("NEGATIVE CONTROL: a null target stays null — no target is not a target of zero", () => {
    expect(trancheInsert({ userId: "u", accountId: "a", draft: draft({ target: null }) }).target).toBeNull();
  });
});

describe("normaliseSymbol", () => {
  test("trims and upper-cases; share-class dots survive", () => {
    expect(normaliseSymbol("  brk.b ")).toBe("BRK.B");
  });
});

describe("closeRejection", () => {
  const open = { opened_at: "2026-09-10T14:00:00Z", closed_at: null };

  test("NEGATIVE CONTROL: an open tranche closes at a later past minute", () => {
    expect(closeRejection(open, PAST, NOW)).toBeNull();
    expect(canCloseTranche(open, PAST, NOW)).toBe(true);
  });

  test("a closed tranche is not closed again", () => {
    const r = closeRejection({ ...open, closed_at: "2026-09-12T10:00:00Z" }, PAST, NOW);
    expect(r).toContain("already closed on 2026-09-12");
  });

  test("the minute must be real and not in the future", () => {
    expect(closeRejection(open, "", NOW)).toContain("to the minute");
    expect(closeRejection(open, "2026-09-17T15:31", NOW)).toContain("future");
  });

  test("a tranche cannot close before it opened — the CHECK's rule, as instants", () => {
    const opened = new Date("2026-09-17T12:00:00");
    const t = { opened_at: opened.toISOString(), closed_at: null };
    expect(closeRejection(t, "2026-09-17T11:59", NOW)).toContain("before it opened");
    expect(closeRejection(t, "2026-09-17T12:00", NOW)).toBeNull();
  });

  test("the patch changes exactly one column", () => {
    expect(Object.keys(trancheClosePatch(PAST))).toEqual(["closed_at"]);
    expect(trancheClosePatch(PAST).closed_at).toBe(new Date(PAST).toISOString());
  });
});

describe("the validator's rules are the schema's", () => {
  // The CHECK this validator restates. Read from the migration so a change to
  // one without the other is visible here.
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/20260912120000_execution_ledger.sql"),
    "utf8",
  );
  const start = sql.indexOf("ADD CONSTRAINT tranches_bounds");
  const check = sql.slice(start, sql.indexOf(");", start));

  test("NEGATIVE CONTROL: the constraint was found", () => {
    expect(start).toBeGreaterThan(0);
    expect(check.length).toBeGreaterThan(50);
  });

  test.each([
    ["symbol", "btrim(symbol) <> ''"],
    ["kind", "kind IN ('core', 'tactical')"],
    ["quantity", "opened_quantity > 0"],
    ["target", "target IS NULL OR target > 0"],
  ])("the %s rule restates a clause of tranches_bounds", (_field, clause) => {
    expect(check).toContain(clause);
  });

  test("the close rule restates the CHECK's ordering clause", () => {
    expect(check).toContain("closed_at IS NULL OR closed_at >= opened_at");
  });
});
