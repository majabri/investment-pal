// The import RPC, run for real (§26.2 mandatory tests 6 and 7; §20.3
// IMP-001..005; rule 29). `import_account_positions` is the one path that
// changes holdings, and until this file its atomicity, its account scoping
// and its narrative-column preservation were Postgres semantics read off the
// migration text. Here the function is called as the client role would call
// it, with a second account and a second user standing by.
import { beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";

import { OTHER_USER as B, TEST_USER as A, actAs, actAsAdmin, one, replayMigrations } from "./replay";

let db: PGlite;
const ids: Record<string, string> = {};
let eventsBeforeFirst: Record<string, number> = {};
const AS_OF = "2026-09-17T20:05:00Z";

type Row = { symbol: string; quantity: number | string; cost_basis: number; current_price: number };
const lit = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;

/** Call the RPC as the current role. Returns the result, or the error message. */
async function importRows(accountId: string, rows: Row[] | unknown, cash: number | null, source = "portfolio_csv") {
  try {
    const r = await one<{ r: Record<string, unknown> }>(
      db,
      `SELECT public.import_account_positions('${accountId}', ${lit(rows)}, ${cash === null ? "NULL::numeric" : cash}, '${AS_OF}', '${source}') r`,
    );
    return { ok: true as const, result: r.r };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
}

/** Every holdings row of an account, whole, as the superuser sees it. */
async function holdingsOf(accountId: string): Promise<Record<string, unknown>[]> {
  await actAsAdmin(db);
  return (await db.query<{ j: Record<string, unknown> }>(`SELECT to_jsonb(h) j FROM holdings h WHERE account_id = '${accountId}' ORDER BY symbol`)).rows.map((r) => r.j);
}
const accountRow = async (accountId: string) => {
  await actAsAdmin(db);
  return (await one<{ j: Record<string, unknown> }>(db, `SELECT to_jsonb(a) j FROM accounts a WHERE id = '${accountId}'`)).j;
};
const count = async (sql: string) => {
  await actAsAdmin(db);
  return Number((await one<{ n: string }>(db, `SELECT count(*)::text n FROM ${sql}`)).n);
};
/** How many events of each type the user has, so a test can assert the delta a write produced. */
async function eventCounts(user: string): Promise<Record<string, number>> {
  await actAsAdmin(db);
  const rows = (await db.query<{ t: string; n: string }>(`SELECT event_type t, count(*)::text n FROM domain_events WHERE user_id = '${user}' GROUP BY 1`)).rows;
  return Object.fromEntries(rows.map((r) => [r.t, Number(r.n)]));
}
const delta = (after: Record<string, number>, before: Record<string, number>) => {
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(after), ...Object.keys(before)])) {
    const d = (after[k] ?? 0) - (before[k] ?? 0);
    if (d !== 0) out[k] = d;
  }
  return out;
};
const instant = (v: unknown) => new Date(String(v)).getTime();

/** Rows with the columns a re-import legitimately rewrites removed. */
const stable = (rows: Record<string, unknown>[]) =>
  rows.map(({ updated_at: _u, last_price_at: _l, ...rest }) => rest);

beforeAll(async () => {
  db = (await replayMigrations()).db;
  await actAs(db, "authenticated", A);
  ids.acct = (await one<{ id: string }>(db, `INSERT INTO accounts (user_id, name, cash) VALUES ('${A}', 'Main', 1234) RETURNING id`)).id;
  ids.acct2 = (await one<{ id: string }>(db, `INSERT INTO accounts (user_id, name) VALUES ('${A}', 'Second') RETURNING id`)).id;
  // The narrative columns rule 29 protects, set on the row the import will update.
  await db.exec(`INSERT INTO holdings (user_id, account_id, symbol, quantity, cost_basis, current_price, original_thesis, why_own, notes) VALUES ('${A}', '${ids.acct}', 'SYMA', 10, 100, 110, 'thesis A', 'because', 'keep me')`);
  await db.exec(`INSERT INTO holdings (user_id, account_id, symbol, quantity, cost_basis, current_price) VALUES ('${A}', '${ids.acct}', 'SYMOLD', 5, 50, 55)`);
  // The same symbol in ANOTHER of A's accounts: an import to the first must not touch it.
  await db.exec(`INSERT INTO holdings (user_id, account_id, symbol, quantity, cost_basis, current_price) VALUES ('${A}', '${ids.acct2}', 'SYMOLD', 7, 70, 77)`);
  await actAs(db, "authenticated", B);
  ids.bAcct = (await one<{ id: string }>(db, `INSERT INTO accounts (user_id, name) VALUES ('${B}', 'Theirs') RETURNING id`)).id;
  await db.exec(`INSERT INTO holdings (user_id, account_id, symbol, quantity, cost_basis, current_price) VALUES ('${B}', '${ids.bAcct}', 'SYMA', 3, 30, 33)`);
});

describe("a successful import (IMP-004 UPDATE-then-INSERT; rule 29)", () => {
  test("updates what it carries, inserts what is new, removes what is absent — and only in this account", async () => {
    const before2 = await holdingsOf(ids.acct2);
    const beforeB = await holdingsOf(ids.bAcct);
    eventsBeforeFirst = await eventCounts(A);
    await actAs(db, "authenticated", A);
    const r = await importRows(ids.acct, [
      { symbol: " syma ", quantity: 12, cost_basis: 101, current_price: 120 }, // normalised to SYMA → update
      { symbol: "SYMN", quantity: 2, cost_basis: 20, current_price: 22 }, // new → insert
    ], 500);
    expect(r.ok).toBe(true);
    expect(r.ok && r.result).toEqual({ account_id: ids.acct, updated: 1, inserted: 1, removed: 1, cash_written: true });

    const rows = await holdingsOf(ids.acct);
    expect(rows.map((h) => h.symbol)).toEqual(["SYMA", "SYMN"]); // SYMOLD gone from THIS account
    const syma = rows[0]!;
    expect([syma.quantity, syma.cost_basis, syma.current_price]).toEqual([12, 101, 120]);
    // Rule 29: the narrative survives a refresh.
    expect([syma.original_thesis, syma.why_own, syma.notes]).toEqual(["thesis A", "because", "keep me"]);
    expect(instant(syma.last_price_at)).toBe(instant(AS_OF));

    // Another account of the same user and another user: byte-identical.
    expect(await holdingsOf(ids.acct2)).toEqual(before2);
    expect(await holdingsOf(ids.bAcct)).toEqual(beforeB);

    const acct = await accountRow(ids.acct);
    expect([acct.cash, acct.balances_source_type, acct.balances_source]).toEqual([500, "imported_snapshot", "portfolio_csv"]);
    expect(instant(acct.last_synced_at)).toBe(instant(AS_OF));
  });

  test("the write raised its events: one AccountImported, and HoldingsReconciled for the update, the insert and the delete", async () => {
    expect(delta(await eventCounts(A), eventsBeforeFirst)).toEqual({ AccountImported: 1, HoldingsReconciled: 3 });
    expect(await count(`audit_log WHERE user_id = '${A}' AND table_name = 'holdings' AND op = 'DELETE'`)).toBe(1);
  });

  test("a NULL cash argument leaves the stored cash alone (IMP-002); it never writes zero", async () => {
    await actAs(db, "authenticated", A);
    await db.exec(`UPDATE accounts SET cash = 1234 WHERE id = '${ids.acct}'`);
    const r = await importRows(ids.acct, [{ symbol: "SYMA", quantity: 12, cost_basis: 101, current_price: 120 }, { symbol: "SYMN", quantity: 2, cost_basis: 20, current_price: 22 }], null);
    expect(r.ok && r.result.cash_written).toBe(false);
    const acct = await accountRow(ids.acct);
    expect(acct.cash).toBe(1234);
    expect(acct.cash).not.toBe(0);
    expect(acct.balances_source).toBe("portfolio_csv"); // untouched from the previous import, not rewritten
  });
});

describe("§26.2 test 7 — the same file twice is idempotent", () => {
  const FILE: Row[] = [
    { symbol: "SYMA", quantity: 12, cost_basis: 101, current_price: 120 },
    { symbol: "SYMN", quantity: 2, cost_basis: 20, current_price: 22 },
  ];
  test("the second import changes no row, inserts nothing, removes nothing, and raises no event", async () => {
    await actAs(db, "authenticated", A);
    const first = await importRows(ids.acct, FILE, 500);
    expect(first.ok).toBe(true);
    const rowsAfterFirst = await holdingsOf(ids.acct);
    const eventsBefore = await eventCounts(A);
    const lastEventId = Number((await one<{ m: string }>(db, `SELECT coalesce(max(id), 0)::text m FROM domain_events`)).m);

    await actAs(db, "authenticated", A);
    const second = await importRows(ids.acct, FILE, 500);
    expect(second.ok && second.result).toEqual({ account_id: ids.acct, updated: 2, inserted: 0, removed: 0, cash_written: true });
    const rowsAfterSecond = await holdingsOf(ids.acct);
    expect(rowsAfterSecond.length).toBe(rowsAfterFirst.length);
    expect(stable(rowsAfterSecond)).toEqual(stable(rowsAfterFirst));
    expect(await count(`holdings WHERE account_id = '${ids.acct}'`)).toBe(2); // no duplicate symbols

    // The record is honest about what happened: each row WAS reconciled by
    // the import (one HoldingsReconciled per row), and each event says that
    // nothing about the holding changed. No AccountImported: last_synced_at
    // did not move. No QuoteUpdated: the price did not move.
    expect(delta(await eventCounts(A), eventsBefore)).toEqual({ HoldingsReconciled: 2 });
    await actAsAdmin(db);
    const changed = (await db.query<{ c: string[] }>(`SELECT payload->'changed' c FROM domain_events WHERE id > ${lastEventId} ORDER BY id`)).rows.map((r) => r.c);
    expect(changed).toEqual([[], []]);
  });
});

describe("§26.2 test 6 — a failed import rolls back completely", () => {
  test("a bad row mid-batch leaves holdings, the account, the audit and the events exactly as they were", async () => {
    const before = await holdingsOf(ids.acct);
    const acctBefore = await accountRow(ids.acct);
    const audit = await count(`audit_log WHERE user_id = '${A}'`);
    const events = await count(`domain_events WHERE user_id = '${A}'`);

    await actAs(db, "authenticated", A);
    const r = await importRows(ids.acct, [
      { symbol: "SYMA", quantity: 99, cost_basis: 1, current_price: 1 }, // would have applied first
      { symbol: "SYMBAD", quantity: "not a number", cost_basis: 1, current_price: 1 }, // fails the cast
      { symbol: "SYMN", quantity: 99, cost_basis: 1, current_price: 1 },
    ], 1);
    expect(r.ok).toBe(false);

    expect(await holdingsOf(ids.acct)).toEqual(before); // including updated_at: the first UPDATE did not survive
    expect(await accountRow(ids.acct)).toEqual(acctBefore); // cash still not 1
    expect(await count(`audit_log WHERE user_id = '${A}'`)).toBe(audit); // the trigger's rows rolled back with it
    expect(await count(`domain_events WHERE user_id = '${A}'`)).toBe(events);
  });

  test("negative control: the same batch without the bad row applies", async () => {
    await actAs(db, "authenticated", A);
    const r = await importRows(ids.acct, [
      { symbol: "SYMA", quantity: 99, cost_basis: 1, current_price: 1 },
      { symbol: "SYMN", quantity: 99, cost_basis: 1, current_price: 1 },
    ], 1);
    expect(r.ok && r.result).toEqual({ account_id: ids.acct, updated: 2, inserted: 0, removed: 0, cash_written: true });
    expect((await holdingsOf(ids.acct))[0]!.quantity).toBe(99);
    expect((await accountRow(ids.acct)).cash).toBe(1);
  });

  test("a payload that is not an array is refused before anything is touched", async () => {
    const before = await holdingsOf(ids.acct);
    await actAs(db, "authenticated", A);
    const r = await importRows(ids.acct, { symbol: "SYMA" }, 7);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("array");
    expect(await holdingsOf(ids.acct)).toEqual(before);
    expect((await accountRow(ids.acct)).cash).not.toBe(7);
  });
});

describe("scope (rule 29; RLS)", () => {
  test("another user cannot import into this account, and nothing of it changes", async () => {
    const before = await holdingsOf(ids.acct);
    await actAs(db, "authenticated", B);
    const r = await importRows(ids.acct, [{ symbol: "SYMX", quantity: 1, cost_basis: 1, current_price: 1 }], 0);
    expect(r.ok).toBe(false);
    expect(await holdingsOf(ids.acct)).toEqual(before);
    expect(await count(`holdings WHERE symbol = 'SYMX'`)).toBe(0);
  });

  test("unsigned callers and unknown accounts are refused", async () => {
    await actAs(db, "anon", null);
    const anon = await importRows(ids.acct, [], 0);
    expect(anon.ok).toBe(false);
    await actAs(db, "authenticated", A);
    const missing = await importRows("00000000-0000-0000-0000-00000000dead", [], 0);
    expect(missing.ok).toBe(false);
    expect(missing.ok === false && missing.error).toContain("No such account");
  });

  test("negative control: the other user's own account imports normally", async () => {
    await actAs(db, "authenticated", B);
    const r = await importRows(ids.bAcct, [{ symbol: "SYMA", quantity: 4, cost_basis: 40, current_price: 44 }], null);
    expect(r.ok && r.result).toEqual({ account_id: ids.bAcct, updated: 1, inserted: 0, removed: 0, cash_written: false });
  });
});
