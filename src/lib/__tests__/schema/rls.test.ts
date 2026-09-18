// Row-level security, exercised (§26.1 "RLS test layer"; §27.2; the gap
// matrix's "database behaviour is proven by reasoning" risk).
//
// Until this file, RLS on every table was verified by reading the migration
// text: the policy says `auth.uid() = user_id`, so it must be so. Here a
// second user tries. Two users each own rows in every table with a policy;
// each acts under the `authenticated` role PostgREST would map them to, and
// every read, update and delete is attempted across the line. The superuser
// (who bypasses RLS) is used only to seed and to count.
//
// Three layers, each a different failure:
//   1. CATALOG — every public table has RLS on, at least one policy, and every
//      policy names auth.uid(). A table added without a policy fails here.
//   2. SWEEP — for every table, the other user sees, updates and deletes zero
//      rows, and the anonymous role sees none. Generic, so a new table is
//      covered the day it is seeded (and the seed list is asserted complete).
//   3. SPECIFIC — WITH CHECK refuses writes on another user's behalf; ownership
//      cannot be reassigned; goal_versions is append-only; audit_log is
//      read-only; events are consumable only by their owner; a balance cannot
//      be filed against another user's account; raise_alerts respects RLS.
import { beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";

import { OTHER_USER as B, TEST_USER as A, actAs, actAsAdmin, affected, one, replayMigrations } from "./replay";

let db: PGlite;
const ids: Record<string, string> = {};

/** The column that names the owner. Every table but `profiles` says `user_id`. */
const ownerColumn = (table: string) => (table === "profiles" ? "id" : "user_id");

const count = async (sql: string) => Number((await one<{ n: string }>(db, `SELECT count(*)::text n FROM ${sql}`)).n);

/**
 * Rows the current role can see, or `"refused"` when it may not even ask.
 * Both mean the same thing for a table the role must not read; the rate-limit
 * ledger revokes the client roles outright, so it answers with the error.
 */
const visible = async (sql: string): Promise<number | "refused"> => {
  try {
    return await count(sql);
  } catch {
    return "refused";
  }
};
const none = (v: number | "refused") => (v === "refused" ? 0 : v);

/**
 * One user's rows in every table, written as that user under the client role,
 * so the seed itself proves WITH CHECK admits a user's own rows. Figures are
 * synthetic; symbols are placeholders.
 */
async function seed(u: string, tag: string): Promise<Record<string, string>> {
  await actAs(db, "authenticated", u);
  const id: Record<string, string> = {};
  // auth.users has a trigger that creates the profile; the seed only makes sure it is there.
  await db.exec(`INSERT INTO profiles (id) VALUES ('${u}') ON CONFLICT (id) DO NOTHING`);
  id.acct = (await one<{ id: string }>(db, `INSERT INTO accounts (user_id, name) VALUES ('${u}', 'Acct ${tag}') RETURNING id`)).id;
  await db.exec(`INSERT INTO account_balances (user_id, account_id, raw_text) VALUES ('${u}', '${id.acct}', 'pasted ${tag}')`);
  id.h = (await one<{ id: string }>(db, `INSERT INTO holdings (user_id, account_id, symbol, quantity, cost_basis, current_price) VALUES ('${u}', '${id.acct}', 'SYM${tag}', 10, 100, 100) RETURNING id`)).id;
  await db.exec(`INSERT INTO ips_lite (user_id, position_cap_pct, margin_cap_pct) VALUES ('${u}', 30, 25)`);
  id.g = (await one<{ id: string }>(db, `INSERT INTO goals (user_id, name) VALUES ('${u}', 'Goal ${tag}') RETURNING id`)).id;
  id.gv = (await one<{ id: string }>(db, `INSERT INTO goal_versions (user_id, goal_id, effective_at, baseline_type, target_value) VALUES ('${u}', '${id.g}', now(), 'manual_plan', 100000) RETURNING id`)).id;
  id.d = (await one<{ id: string }>(db, `INSERT INTO decisions (user_id, recommendation, decision, review_type, decided_on) VALUES ('${u}', 'hold ${tag}', 'pending', 'morning', current_date) RETURNING id`)).id;
  id.t = (await one<{ id: string }>(db, `INSERT INTO tranches (user_id, account_id, symbol, kind, opened_at, opened_quantity) VALUES ('${u}', '${id.acct}', 'SYM${tag}', 'tactical', now() - interval '1 day', 10) RETURNING id`)).id;
  id.o = (await one<{ id: string }>(db, `INSERT INTO orders (user_id, account_id, symbol, side, order_type, status, execution_source, decision_id, tranche_id) VALUES ('${u}', '${id.acct}', 'SYM${tag}', 'buy', 'stop', 'untriggered', 'user_entry', '${id.d}', '${id.t}') RETURNING id`)).id;
  await db.exec(`INSERT INTO fills (user_id, order_id, filled_at, quantity, price, source) VALUES ('${u}', '${id.o}', now(), 5, 100, 'user_entry')`);
  await db.exec(`INSERT INTO portfolio_snapshots (user_id, account_id, scope, gross, net, margin_used) VALUES ('${u}', '${id.acct}', 'account', 1000, 900, 100)`);
  id.b = (await one<{ id: string }>(db, `INSERT INTO import_batches (user_id, account_id, source, file_name, checksum_sha256, parsed_rows, valid_rows, outcome) VALUES ('${u}', '${id.acct}', 'imported', 'positions.csv', repeat('${tag.toLowerCase().charAt(0)}', 64), 1, 1, 'committed') RETURNING id`)).id;
  await db.exec(`INSERT INTO sync_log (user_id, source, status, batch_id) VALUES ('${u}', 'csv', 'ok', '${id.b}')`);
  id.alert = (await one<{ id: string }>(db, `INSERT INTO alerts (user_id, account_id, type, severity, message, href, fingerprint) VALUES ('${u}', '${id.acct}', 'stale_quote', 'info', 'Positions were last imported 3 days ago.', '/settings', 'stale_quote:positions-#-days') RETURNING id`)).id;
  await db.exec(`INSERT INTO price_history (user_id, symbol, date, close) VALUES ('${u}', 'SYM${tag}', current_date, 100)`);
  await db.exec(`INSERT INTO journal_entries (user_id, entry_type, body) VALUES ('${u}', 'note', 'entry ${tag}')`);
  await db.exec(`INSERT INTO watchlist (user_id, symbol) VALUES ('${u}', 'SYM${tag}')`);
  await db.exec(`INSERT INTO cash_flows (user_id, account_id, flow_date, kind, amount, treatment, source) VALUES ('${u}', '${id.acct}', current_date, 'deposit', 100, 'external', 'user_entry')`);
  await db.exec(`INSERT INTO household_members (user_id, display_name) VALUES ('${u}', 'Member ${tag}')`);
  await db.exec(`INSERT INTO investment_universe (user_id, symbol) VALUES ('${u}', 'SYM${tag}')`);
  await db.exec(`INSERT INTO position_lots (user_id, account_id, symbol, source) VALUES ('${u}', '${id.acct}', 'SYM${tag}', 'user_entry')`);
  await db.exec(`INSERT INTO priorities (user_id, label) VALUES ('${u}', 'Priority ${tag}')`);
  await db.exec(`INSERT INTO recommended_actions (user_id, category) VALUES ('${u}', 'review')`);
  id.sec = (await one<{ id: string }>(db, `INSERT INTO securities (user_id, canonical_symbol, asset_class) VALUES ('${u}', 'SYM${tag}', 'equity') RETURNING id`)).id;
  await db.exec(`INSERT INTO security_aliases (user_id, security_id, alias, alias_kind, source) VALUES ('${u}', '${id.sec}', 'ALIAS${tag}', 'ticker', 'user_entry')`);
  id.strat = (await one<{ id: string }>(db, `INSERT INTO strategies (user_id, name) VALUES ('${u}', 'Strategy ${tag}') RETURNING id`)).id;
  await db.exec(`INSERT INTO strategy_symbols (user_id, strategy_id, symbol, bucket) VALUES ('${u}', '${id.strat}', 'SYM${tag}', 'core')`);
  // No client policy exists for this one; only the superuser (standing in for
  // service_role's SECURITY DEFINER function) can write it.
  await actAsAdmin(db);
  await db.exec(`INSERT INTO server_request_limits (user_id, scope, window_started_at) VALUES ('${u}', 'chat', now())`);
  return id;
}

let tables: string[] = [];

beforeAll(async () => {
  db = (await replayMigrations()).db;
  Object.assign(ids, await seed(A, "A"));
  await seed(B, "B");
  await actAsAdmin(db);
  tables = (await db.query<{ t: string }>(
    "SELECT c.relname t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1",
  )).rows.map((r) => r.t);
});

describe("1. the catalog", () => {
  test("every public table has row-level security enabled", async () => {
    const off = (await db.query<{ t: string }>(
      "SELECT c.relname t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity ORDER BY 1",
    )).rows.map((r) => r.t);
    expect(off).toEqual([]);
    expect(tables.length).toBeGreaterThanOrEqual(31); // negative control: the query saw the schema
  });

  test("every table has a policy, except the one the client is meant never to touch", async () => {
    const without = (await db.query<{ t: string }>(
      "SELECT c.relname t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) ORDER BY 1",
    )).rows.map((r) => r.t);
    // RLS on with no policy is deny-all for every non-owner role. That is the
    // intent for the rate-limit ledger, which a SECURITY DEFINER function writes.
    expect(without).toEqual(["server_request_limits"]);
  });

  test("every policy is scoped by auth.uid(); none is `true`", async () => {
    const policies = (await db.query<{ t: string; name: string; cmd: string; qual: string | null; check: string | null }>(
      "SELECT tablename t, policyname name, cmd, qual, with_check \"check\" FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2",
    )).rows;
    expect(policies.length).toBeGreaterThanOrEqual(33);
    for (const p of policies) {
      const scoped = [p.qual, p.check].filter((x): x is string => x !== null);
      expect(scoped.length).toBeGreaterThan(0);
      for (const expr of scoped) {
        expect(expr).toContain("auth.uid()");
        expect(expr.trim()).not.toBe("true");
      }
      // A policy that admits writes must constrain the NEW row too.
      if (p.cmd === "ALL" || p.cmd === "INSERT" || p.cmd === "UPDATE") expect(p.check).toContain("auth.uid()");
    }
  });
});

describe("2. the sweep — the other user and the anonymous role", () => {
  test("both users own rows in every table, so the sweep is not vacuous", async () => {
    await actAsAdmin(db);
    const unseeded: string[] = [];
    for (const t of tables) {
      const a = await count(`${t} WHERE ${ownerColumn(t)} = '${A}'`);
      const b = await count(`${t} WHERE ${ownerColumn(t)} = '${B}'`);
      if (a === 0 || b === 0) unseeded.push(t);
    }
    expect(unseeded).toEqual([]);
  });

  test("each user sees exactly their own rows, and only where a policy grants it", async () => {
    await actAsAdmin(db);
    const own = new Map<string, number>();
    for (const t of tables) own.set(t, await count(`${t} WHERE ${ownerColumn(t)} = '${A}'`));
    await actAs(db, "authenticated", A);
    for (const t of tables) {
      const seen = await visible(t);
      if (t === "server_request_limits") expect(none(seen)).toBe(0); // deny-all by design
      else expect([t, seen]).toEqual([t, own.get(t) ?? -1]);
    }
  });

  test("the other user reads, updates and deletes nothing of A's", async () => {
    await actAsAdmin(db);
    const before = new Map<string, number>();
    for (const t of tables) before.set(t, await count(`${t} WHERE ${ownerColumn(t)} = '${A}'`));

    await actAs(db, "authenticated", B);
    for (const t of tables) {
      const col = ownerColumn(t);
      expect([t, none(await visible(`${t} WHERE ${col} = '${A}'`))]).toEqual([t, 0]);
      // A no-op update: touches every row the role may see. Must be none of A's.
      const upd = await affected(db, `UPDATE ${t} SET ${col} = ${col} WHERE ${col} = '${A}'`);
      expect([t, upd === "refused" ? 0 : upd]).toEqual([t, 0]);
      const del = await affected(db, `DELETE FROM ${t} WHERE ${col} = '${A}'`);
      expect([t, del === "refused" ? 0 : del]).toEqual([t, 0]);
    }

    await actAsAdmin(db);
    for (const t of tables) expect([t, await count(`${t} WHERE ${ownerColumn(t)} = '${A}'`)]).toEqual([t, before.get(t) ?? -1]);
  });

  test("the anonymous role sees no row of anyone's", async () => {
    await actAs(db, "anon", null);
    for (const t of tables) expect([t, none(await visible(t))]).toEqual([t, 0]);
  });

  test("negative control: the same no-op update by the owner touches every one of their rows", async () => {
    await actAsAdmin(db);
    const holdings = await count(`holdings WHERE user_id = '${A}'`);
    const goals = await count(`goals WHERE user_id = '${A}'`);
    expect(holdings).toBeGreaterThan(0);
    await actAs(db, "authenticated", A);
    expect(await affected(db, `UPDATE holdings SET symbol = symbol`)).toBe(holdings);
    expect(await affected(db, `UPDATE goals SET name = name`)).toBe(goals);
  });
});

describe("3. the specific rules", () => {
  test("WITH CHECK: a user cannot write a row on another user's behalf", async () => {
    await actAs(db, "authenticated", B);
    expect(await affected(db, `INSERT INTO holdings (user_id, account_id, symbol, quantity) VALUES ('${A}', '${ids.acct}', 'SYMX', 1)`)).toBe("refused");
    expect(await affected(db, `INSERT INTO decisions (user_id, recommendation, decision, review_type, decided_on) VALUES ('${A}', 'x', 'pending', 'morning', current_date)`)).toBe("refused");
    expect(await affected(db, `INSERT INTO journal_entries (user_id, entry_type, body) VALUES ('${A}', 'note', 'planted')`)).toBe("refused");
    expect(await affected(db, `INSERT INTO alerts (user_id, type, severity, message, href, fingerprint) VALUES ('${A}', 'stale_quote', 'info', 'planted', '/x', 'planted')`)).toBe("refused");
    // Negative control: the same statements for their own rows succeed.
    expect(await affected(db, `INSERT INTO journal_entries (user_id, entry_type, body) VALUES ('${B}', 'note', 'mine')`)).toBe(1);
  });

  test("ownership cannot be reassigned: an UPDATE that hands a row to another user is refused", async () => {
    await actAs(db, "authenticated", A);
    expect(await affected(db, `UPDATE holdings SET user_id = '${B}' WHERE id = '${ids.h}'`)).toBe("refused");
    expect(await affected(db, `UPDATE decisions SET user_id = '${B}' WHERE id = '${ids.d}'`)).toBe("refused");
    await actAsAdmin(db);
    expect((await one<{ user_id: string }>(db, `SELECT user_id FROM holdings WHERE id = '${ids.h}'`)).user_id).toBe(A);
  });

  test("goal_versions is append-only for its owner: insert yes, update and delete touch nothing", async () => {
    await actAs(db, "authenticated", A);
    expect(await affected(db, `INSERT INTO goal_versions (user_id, goal_id, effective_at, baseline_type, target_value) VALUES ('${A}', '${ids.g}', now(), 'manual_plan', 120000)`)).toBe(1);
    expect(await affected(db, `UPDATE goal_versions SET target_value = 1 WHERE id = '${ids.gv}'`)).toBe(0);
    expect(await affected(db, `DELETE FROM goal_versions WHERE id = '${ids.gv}'`)).toBe(0);
    await actAsAdmin(db);
    expect((await one<{ v: string }>(db, `SELECT target_value::text v FROM goal_versions WHERE id = '${ids.gv}'`)).v).toBe("100000");
  });

  test("audit_log is read-only for its owner and invisible to anyone else", async () => {
    await actAs(db, "authenticated", A);
    const mine = await count("audit_log");
    expect(mine).toBeGreaterThan(0);
    expect(await affected(db, `INSERT INTO audit_log (user_id, table_name, row_id, op, new_row) VALUES ('${A}', 'holdings', gen_random_uuid(), 'INSERT', '{}'::jsonb)`)).toBe("refused");
    // Since 20260918170000 the client role holds SELECT only, so these are
    // refused outright rather than touching zero rows. Either is "nothing".
    expect(none(await affected(db, "UPDATE audit_log SET op = op"))).toBe(0);
    expect(none(await affected(db, "DELETE FROM audit_log"))).toBe(0);
    await actAs(db, "authenticated", B);
    expect(await count(`audit_log WHERE user_id = '${A}'`)).toBe(0);
  });

  test("domain_events: the owner can consume their own event; nobody else can", async () => {
    await actAsAdmin(db);
    const ev = await one<{ id: string }>(db, `SELECT id::text FROM domain_events WHERE user_id = '${A}' AND consumed_at IS NULL ORDER BY id LIMIT 1`);
    await actAs(db, "authenticated", B);
    expect(await affected(db, `UPDATE domain_events SET consumed_at = now() WHERE id = ${ev.id}`)).toBe(0);
    await actAs(db, "authenticated", A);
    expect(await affected(db, `UPDATE domain_events SET consumed_at = now() WHERE id = ${ev.id}`)).toBe(1);
    // Events are raised by the trigger, never by the client directly.
    expect(await affected(db, `INSERT INTO domain_events (user_id, event_type, aggregate_type, aggregate_id) VALUES ('${A}', 'GoalChanged', 'goals', '${ids.g}')`)).toBe("refused");
    await actAsAdmin(db);
    expect((await one<{ c: string | null }>(db, `SELECT consumed_at::text c FROM domain_events WHERE id = ${ev.id}`)).c).not.toBeNull();
  });

  test("a balance cannot be filed against another user's account, even under one's own user_id", async () => {
    await actAs(db, "authenticated", B);
    expect(await affected(db, `INSERT INTO account_balances (user_id, account_id, raw_text) VALUES ('${B}', '${ids.acct}', 'planted')`)).toBe("refused");
    // Negative control: the same insert against their own account succeeds.
    await actAsAdmin(db);
    const own = await one<{ id: string }>(db, `SELECT id FROM accounts WHERE user_id = '${B}' LIMIT 1`);
    await actAs(db, "authenticated", B);
    expect(await affected(db, `INSERT INTO account_balances (user_id, account_id, raw_text) VALUES ('${B}', '${own.id}', 'mine')`)).toBe(1);
  });

  test("raise_alerts runs as the caller: another user's account is not theirs to raise on", async () => {
    await actAs(db, "authenticated", B);
    const payload = `'[{"type":"stale_quote","severity":"info","message":"x","href":"/x","fingerprint":"planted"}]'::jsonb`;
    let refusedOrEmpty = false;
    try {
      await db.query(`SELECT public.raise_alerts('${ids.acct}', ${payload})`);
    } catch {
      refusedOrEmpty = true;
    }
    await actAsAdmin(db);
    const planted = await count(`alerts WHERE account_id = '${ids.acct}' AND fingerprint = 'planted'`);
    expect(refusedOrEmpty || planted === 0).toBe(true);
    expect(planted).toBe(0);
  });

  test("the trigger's SECURITY DEFINER writes still land under the row's owner, not the caller", async () => {
    await actAs(db, "authenticated", B);
    await db.exec(`UPDATE holdings SET quantity = 11 WHERE user_id = '${B}'`);
    await actAsAdmin(db);
    const rows = (await db.query<{ user_id: string }>(`SELECT user_id FROM audit_log WHERE table_name = 'holdings' AND op = 'UPDATE' AND new_row->>'quantity' = '11'`)).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.user_id).toBe(B);
  });
});
