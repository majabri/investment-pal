// Rerank after a sale (BR-004; migration 20260919000000), exercised in PGlite
// before Lovable sees it. Rules: one rerank per event; only the owner's
// TrancheClosed events; the sold symbol excluded for the window and never
// shortened; excluded names last in the ranking; a symbol not in the
// universe recorded as such; the client reads and never writes directly.
// Symbols and figures are placeholders.
import { beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MIGRATIONS_DIR, OTHER_USER as B, TEST_USER as A, actAs, actAsAdmin, affected, one, refused, replayMigrations } from "./replay";

const MIGRATION = "20260919000000_universe_reranks.sql";

let db: PGlite;
let acct = "";
let tranche = "";
let closeEvent = 0;

const n = async (sql: string) => Number((await one<{ v: string }>(db, `SELECT (SELECT ${sql})::text v`)).v);
/** The refusal's own words, so a test can tell WHICH guard refused. */
const refusalOf = async (sql: string): Promise<string> => {
  try {
    await db.query(sql);
    return "";
  } catch (e) {
    return String((e as Error).message);
  }
};
const rerank = async (eventId: number, days: number) =>
  (await one<{ r: string }>(db, `SELECT record_universe_rerank(${eventId}, ${days})::text r`)).r;
const parsed = async (eventId: number, days: number) => JSON.parse(await rerank(eventId, days)) as {
  id: number; symbol: string; in_universe: boolean; excluded_until: string | null; rank_version: string; names: number; repeated: boolean;
};
const openTranche = async (symbol: string) =>
  (await one<{ id: string }>(db, `INSERT INTO tranches (user_id, account_id, symbol, kind, opened_at, opened_quantity) VALUES ('${A}', '${acct}', '${symbol}', 'tactical', now() - interval '2 days', 10) RETURNING id`)).id;
const closeTranche = async (id: string) => {
  await db.exec(`UPDATE tranches SET closed_at = now() WHERE id = '${id}'`);
  return n(`max(id) FROM domain_events WHERE user_id = '${A}' AND event_type = 'TrancheClosed' AND aggregate_id = '${id}'`);
};

beforeAll(async () => {
  db = (await replayMigrations()).db;
  await actAs(db, "authenticated", A);
  acct = (await one<{ id: string }>(db, `INSERT INTO accounts (user_id, name) VALUES ('${A}', 'Acct') RETURNING id`)).id;
  await db.exec(`INSERT INTO investment_universe (user_id, symbol, tier, overall_conviction) VALUES
    ('${A}', 'SYMA', 'top25', 9), ('${A}', 'SYMB', 'top100', 5), ('${A}', 'SYMC', 'top25', 3), ('${A}', 'SYMD', 'bench', NULL)`);
  tranche = await openTranche("SYMA");
  closeEvent = await closeTranche(tranche);
  await actAsAdmin(db);
});

describe("the migration", () => {
  test("applies twice to the same state", async () => {
    const before = await n("count(*) FROM pg_policies WHERE tablename = 'universe_reranks'");
    await db.exec(readFileSync(join(MIGRATIONS_DIR, MIGRATION), "utf8"));
    expect(await n("count(*) FROM pg_policies WHERE tablename = 'universe_reranks'")).toBe(before);
    expect(before).toBe(1);
  });

  test("catalog: RLS on, SELECT policy scoped by auth.uid(), the two universe columns exist", async () => {
    expect((await one<{ on: boolean }>(db, "SELECT relrowsecurity \"on\" FROM pg_class WHERE relname = 'universe_reranks'")).on).toBe(true);
    const p = await one<{ cmd: string; qual: string }>(db, "SELECT cmd, qual FROM pg_policies WHERE tablename = 'universe_reranks'");
    expect(p.cmd).toBe("SELECT");
    expect(p.qual).toContain("auth.uid()");
    const cols = (await db.query<{ c: string }>("SELECT column_name c FROM information_schema.columns WHERE table_name = 'investment_universe' AND column_name IN ('excluded_until','excluded_reason') ORDER BY 1")).rows.map((r) => r.c);
    expect(cols).toEqual(["excluded_reason", "excluded_until"]);
  });

  test("grants: client SELECT only on the record; anon nothing; the function to authenticated only", async () => {
    const priv = async (role: string, p: string) => (await one<{ ok: boolean }>(db, `SELECT has_table_privilege('${role}', 'public.universe_reranks', '${p}') ok`)).ok;
    expect(await priv("authenticated", "SELECT")).toBe(true);
    for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) expect([p, await priv("authenticated", p)]).toEqual([p, false]);
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) expect([p, await priv("anon", p)]).toEqual([p, false]);
    const fn = async (role: string) => (await one<{ ok: boolean }>(db, `SELECT has_function_privilege('${role}', 'public.record_universe_rerank(bigint, int)', 'EXECUTE') ok`)).ok;
    expect(await fn("authenticated")).toBe(true);
    expect(await fn("anon")).toBe(false);
  });
});

describe("record_universe_rerank", () => {
  test("the trigger raised TrancheClosed for the close — the input exists (negative control)", async () => {
    expect(closeEvent).toBeGreaterThan(0);
  });

  test("records the rerank: the sold symbol excluded for the window, and last in the ranking whatever its tier", async () => {
    await actAs(db, "authenticated", A);
    const r = await parsed(closeEvent, 30);
    expect(r).toMatchObject({ symbol: "SYMA", in_universe: true, rank_version: "rank-v2", names: 4, repeated: false });
    await actAsAdmin(db);
    const row = await one<{ excluded_until: string | null; excluded_reason: string | null }>(db, `SELECT excluded_until::text, excluded_reason FROM investment_universe WHERE user_id = '${A}' AND symbol = 'SYMA'`);
    expect(row.excluded_until).not.toBeNull();
    expect(row.excluded_reason).toContain(`#${closeEvent}`);
    const days = await n(`extract(epoch FROM (excluded_until - now())) / 86400 FROM investment_universe WHERE user_id = '${A}' AND symbol = 'SYMA'`);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    const ranking = JSON.parse((await one<{ j: string }>(db, `SELECT ranking::text j FROM universe_reranks WHERE id = ${r.id}`)).j) as { rank: number; symbol: string; excluded: boolean }[];
    // rank-v2: SYMC (top25, 3) ahead of SYMB (top100, 5); unscored SYMD after them; the excluded top25 SYMA LAST.
    expect(ranking.map((x) => x.symbol)).toEqual(["SYMC", "SYMB", "SYMD", "SYMA"]);
    expect(ranking[3]).toMatchObject({ rank: 4, excluded: true });
    expect(ranking.slice(0, 3).every((x) => !x.excluded)).toBe(true);
  });

  test("idempotent: a second call for the same event returns the first record and writes nothing", async () => {
    await actAs(db, "authenticated", A);
    const first = await parsed(closeEvent, 30);
    const again = await parsed(closeEvent, 90);
    expect(again.id).toBe(first.id);
    expect(again.repeated).toBe(true);
    await actAsAdmin(db);
    expect(await n(`count(*) FROM universe_reranks WHERE event_id = ${closeEvent}`)).toBe(1);
    // And the 90-day window on the repeat did not extend the exclusion.
    const days = await n(`extract(epoch FROM (excluded_until - now())) / 86400 FROM investment_universe WHERE user_id = '${A}' AND symbol = 'SYMA'`);
    expect(days).toBeLessThanOrEqual(30);
  });

  test("never shortens an exclusion already in force; a longer one extends it", async () => {
    await actAsAdmin(db);
    const t2 = await openTranche("SYMA");
    const e2 = await closeTranche(t2);
    await actAs(db, "authenticated", A);
    await parsed(e2, 7); // shorter than the 30 in force
    await actAsAdmin(db);
    expect(await n(`extract(epoch FROM (excluded_until - now())) / 86400 FROM investment_universe WHERE user_id = '${A}' AND symbol = 'SYMA'`)).toBeGreaterThan(29);
    const t3 = await openTranche("SYMA");
    const e3 = await closeTranche(t3);
    await actAs(db, "authenticated", A);
    await parsed(e3, 60);
    await actAsAdmin(db);
    expect(await n(`extract(epoch FROM (excluded_until - now())) / 86400 FROM investment_universe WHERE user_id = '${A}' AND symbol = 'SYMA'`)).toBeGreaterThan(59);
  });

  test("a sold symbol that is not in the universe is recorded as such; nothing is invented to exclude", async () => {
    await actAsAdmin(db);
    const t = await openTranche("SYMZ");
    const e = await closeTranche(t);
    await actAs(db, "authenticated", A);
    const r = await parsed(e, 30);
    expect(r).toMatchObject({ symbol: "SYMZ", in_universe: false, excluded_until: null, names: 4 });
    await actAsAdmin(db);
    expect(await n(`count(*) FROM investment_universe WHERE user_id = '${A}' AND symbol = 'SYMZ'`)).toBe(0);
  });

  test("refuses a window outside 1–365 days, an event that is not TrancheClosed, and an unknown event", async () => {
    await actAs(db, "authenticated", A);
    expect(await refused(db, `SELECT record_universe_rerank(${closeEvent}, 0)`)).toBe(true);
    expect(await refused(db, `SELECT record_universe_rerank(${closeEvent}, 366)`)).toBe(true);
    await actAsAdmin(db);
    // Raise an event of another type on purpose (a holding insert → HoldingsReconciled).
    await db.exec(`INSERT INTO holdings (user_id, account_id, symbol, quantity, cost_basis, current_price) VALUES ('${A}', '${acct}', 'SYMH', 1, 1, 1)`);
    const other = await n(`max(id) FROM domain_events WHERE user_id = '${A}' AND event_type <> 'TrancheClosed'`);
    expect(other).toBeGreaterThan(0); // negative control: such an event exists
    await actAs(db, "authenticated", A);
    // The TYPE guard refuses it, not the later "names no tranche" guard: the
    // message says which, so dropping the type check cannot pass on the other.
    expect(await refusalOf(`SELECT record_universe_rerank(${other}, 30)`)).toContain("not TrancheClosed");
    expect(await refusalOf("SELECT record_universe_rerank(999999999, 30)")).toContain("not one of the owner's events");
    expect(await refusalOf(`SELECT record_universe_rerank(${closeEvent}, 0)`)).toContain("1–365");
    await actAsAdmin(db);
  });

  test("another user cannot rerank on A's event, see A's records, or write the record directly", async () => {
    await actAs(db, "authenticated", B);
    expect(await refused(db, `SELECT record_universe_rerank(${closeEvent}, 30)`)).toBe(true);
    expect(await n("count(*) FROM universe_reranks")).toBe(0);
    expect(await affected(db, `INSERT INTO universe_reranks (user_id, event_id, symbol, in_universe, rank_version, ranking) VALUES ('${B}', ${closeEvent}, 'SYMA', true, 'x', '[]'::jsonb)`)).toBe("refused");
    await actAs(db, "authenticated", A);
    expect(await n("count(*) FROM universe_reranks")).toBeGreaterThan(0); // negative control: the owner reads its own
    expect(await affected(db, "DELETE FROM universe_reranks")).toBe("refused");
    await actAsAdmin(db);
  });
});
