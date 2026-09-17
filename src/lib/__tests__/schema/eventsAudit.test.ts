// The events / audit / import-batch / order-links migration, run for real
// (§19, §20.2, §12.1–12.2, SYS-004). The first schema test in the repo:
// before this, a migration's first execution was Lovable's, in production.
import { beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MIGRATIONS_DIR, TEST_USER as U, one, refused, replayMigrations, signIn } from "./replay";

const MIGRATION = "20260917150000_events_audit_imports_orders.sql";

const EVENTS = [
  "AccountImported", "HoldingsReconciled", "QuoteUpdated", "ValuationCompleted",
  "GoalChanged", "PolicyChanged", "DecisionCreated", "DecisionAccepted",
  "OrderOpened", "FillRecorded", "TrancheClosed", "OutcomeMeasured",
  "ModelEvaluated", "AlertRaised",
];

let db: PGlite;
let duplicates: string[];
let applied: string[];
const ids: Record<string, string> = {};

beforeAll(async () => {
  const r = await replayMigrations();
  db = r.db;
  duplicates = r.duplicates;
  applied = r.applied;
  await signIn(db);
});

describe("every migration replays", () => {
  test("all files apply, in order, on a fresh database", () => {
    expect(applied.length + duplicates.length).toBeGreaterThan(50);
    expect(applied).toContain(MIGRATION);
  });

  test("the only tolerated failures are Lovable's non-idempotent copies", () => {
    // Five known. A sixth is a new non-idempotent file, which is a finding.
    expect(duplicates).toEqual([
      "20260909144407_bb261240-3412-4832-b02b-a481bcb40ffa.sql",
      "20260909144443_c52ebaed-9b2e-4a93-83d7-3f025554bb1f.sql",
      "20260909144513_7f2de6c3-fbd8-4fc3-b1e6-ddc336bfbbfb.sql",
      "20260909144540_a5ce6d46-5f62-42b4-84ed-10f2a5832fd4.sql",
      "20260910003712_c2faa9c6-44e4-44ce-ac79-98b19a19fa5d.sql",
    ]);
  });

  test("the candidate is idempotent: applying it again changes nothing", async () => {
    const before = await one<{ n: string }>(db, "SELECT count(*)::text n FROM pg_trigger WHERE tgname LIKE 'trg_%_record_change'");
    await db.exec(readFileSync(join(MIGRATIONS_DIR, MIGRATION), "utf8"));
    const after = await one<{ n: string }>(db, "SELECT count(*)::text n FROM pg_trigger WHERE tgname LIKE 'trg_%_record_change'");
    expect(after.n).toBe(before.n);
    expect(Number(after.n)).toBe(9);
  });
});

describe("record_change raises the named events from the writes that cause them", () => {
  test("a manual trade lifecycle, end to end (§A.3)", async () => {
    ids.acct = (await one<{ id: string }>(db, `INSERT INTO accounts (user_id, name) VALUES ('${U}', 'Test') RETURNING id`)).id;
    await db.exec(`UPDATE accounts SET last_synced_at = now() WHERE id = '${ids.acct}'`);
    ids.h = (await one<{ id: string }>(db, `INSERT INTO holdings (user_id, account_id, symbol, quantity, cost_basis, current_price) VALUES ('${U}', '${ids.acct}', 'AAA', 10, 100, 100) RETURNING id`)).id;
    await db.exec(`UPDATE holdings SET current_price = 101, last_price_at = now() WHERE id = '${ids.h}'`);
    await db.exec(`UPDATE holdings SET quantity = 12 WHERE id = '${ids.h}'`);
    await db.exec(`INSERT INTO ips_lite (user_id, position_cap_pct, margin_cap_pct) VALUES ('${U}', 30, 25)`);
    await db.exec(`UPDATE ips_lite SET position_cap_pct = 25 WHERE user_id = '${U}'`);
    ids.g = (await one<{ id: string }>(db, `INSERT INTO goals (user_id, name) VALUES ('${U}', 'G') RETURNING id`)).id;
    await db.exec(`INSERT INTO goal_versions (user_id, goal_id, effective_at, baseline_type, target_value) VALUES ('${U}', '${ids.g}', now(), 'manual_plan', 100000)`);
    ids.d = (await one<{ id: string }>(db, `INSERT INTO decisions (user_id, recommendation, decision, review_type, decided_on) VALUES ('${U}', 'buy some', 'pending', 'morning', current_date) RETURNING id`)).id;
    await db.exec(`UPDATE decisions SET decision = 'followed' WHERE id = '${ids.d}'`);
    await db.exec(`UPDATE decisions SET outcome_1d = 1.5 WHERE id = '${ids.d}'`);
    // NEGATIVE CONTROL: an edit to the wording is audited and raises nothing.
    await db.exec(`UPDATE decisions SET recommendation = 'buy some more' WHERE id = '${ids.d}'`);
    ids.t = (await one<{ id: string }>(db, `INSERT INTO tranches (user_id, account_id, symbol, kind, opened_at, opened_quantity) VALUES ('${U}', '${ids.acct}', 'AAA', 'tactical', now() - interval '1 day', 10) RETURNING id`)).id;
    await db.exec(`UPDATE tranches SET closed_at = now() WHERE id = '${ids.t}'`);
    ids.o = (await one<{ id: string }>(db, `INSERT INTO orders (user_id, account_id, symbol, side, order_type, status, execution_source, decision_id, tranche_id) VALUES ('${U}', '${ids.acct}', 'AAA', 'buy', 'stop', 'untriggered', 'user_entry', '${ids.d}', '${ids.t}') RETURNING id`)).id;
    await db.exec(`INSERT INTO fills (user_id, order_id, filled_at, quantity, price, source) VALUES ('${U}', '${ids.o}', now(), 5, 100, 'user_entry')`);
    await db.exec(`INSERT INTO portfolio_snapshots (user_id, account_id, scope, gross, net, margin_used) VALUES ('${U}', '${ids.acct}', 'account', 1000, 900, 100)`);

    const rows = (await db.query<{ event_type: string; n: string }>("SELECT event_type, count(*)::text n FROM domain_events GROUP BY 1 ORDER BY 1")).rows;
    const counts = Object.fromEntries(rows.map((r) => [r.event_type, Number(r.n)]));
    expect(counts).toEqual({
      AccountImported: 1,
      DecisionAccepted: 1,
      DecisionCreated: 1,
      FillRecorded: 1,
      GoalChanged: 1,
      HoldingsReconciled: 2, // the insert, and the quantity change
      OrderOpened: 1,
      OutcomeMeasured: 1,
      PolicyChanged: 2,
      QuoteUpdated: 1, // the price-only update, and only that one
      TrancheClosed: 1,
      ValuationCompleted: 1,
    });
  });

  test("every event points at the audit row that raised it", async () => {
    const linked = await one<{ n: string }>(db, "SELECT count(*)::text n FROM domain_events e JOIN audit_log a ON a.id = e.audit_id");
    const total = await one<{ n: string }>(db, "SELECT count(*)::text n FROM domain_events");
    expect(linked.n).toBe(total.n);
    expect(Number(total.n)).toBe(14);
  });

  test("every write is audited, including the ones that raise no event", async () => {
    const rows = (await db.query<{ k: string; n: string }>("SELECT table_name || ':' || op k, count(*)::text n FROM audit_log GROUP BY 1 ORDER BY 1")).rows;
    const counts = Object.fromEntries(rows.map((r) => [r.k, Number(r.n)]));
    expect(counts["decisions:UPDATE"]).toBe(3); // followed, outcome, wording
    expect(counts["holdings:UPDATE"]).toBe(2);
    expect(counts["tranches:UPDATE"]).toBe(1);
    expect(counts["fills:INSERT"]).toBe(1);
  });

  test("an audit row holds the whole row before and after, and who changed it", async () => {
    const r = await one<{ old_q: string; new_q: string; by: string }>(
      db,
      `SELECT old_row->>'quantity' old_q, new_row->>'quantity' new_q, changed_by::text "by" FROM audit_log WHERE table_name = 'holdings' AND op = 'UPDATE' AND new_row->>'quantity' = '12'`,
    );
    expect(r.old_q).toBe("10");
    expect(r.new_q).toBe("12");
    expect(r.by).toBe(U);
  });

  test("an update's payload names the changed columns and never updated_at", async () => {
    const r = await one<{ p: { op: string; changed: string[] } }>(db, "SELECT payload p FROM domain_events WHERE event_type = 'QuoteUpdated'");
    expect(r.p.op).toBe("UPDATE");
    expect(r.p.changed.sort()).toEqual(["current_price", "last_price_at"]);
  });

  test("a closed tranche closed again raises nothing more", async () => {
    await db.exec(`UPDATE tranches SET note = 'x' WHERE id = '${ids.t}'`);
    const r = await one<{ n: string }>(db, "SELECT count(*)::text n FROM domain_events WHERE event_type = 'TrancheClosed'");
    expect(Number(r.n)).toBe(1);
  });
});

describe("the contracts are enforced by the schema, not by the app", () => {
  test("only the fourteen §19.1 names are events", async () => {
    expect(await refused(db, `INSERT INTO domain_events (user_id, event_type, aggregate_type, aggregate_id) VALUES ('${U}', 'SomethingElse', 'x', gen_random_uuid())`)).toBe(true);
    // NEGATIVE CONTROL: a name on the list is accepted by the CHECK.
    expect(await refused(db, `INSERT INTO domain_events (user_id, event_type, aggregate_type, aggregate_id) VALUES ('${U}', 'AlertRaised', 'alerts', gen_random_uuid())`)).toBe(false);
    for (const e of EVENTS) {
      const sql = readFileSync(join(MIGRATIONS_DIR, MIGRATION), "utf8");
      expect(sql).toContain(`'${e}'`);
    }
  });

  test("orders admit untriggered and superseded, and still refuse a broker's word", async () => {
    expect(await refused(db, `INSERT INTO orders (user_id, account_id, symbol, side, order_type, status, execution_source) VALUES ('${U}', '${ids.acct}', 'AAA', 'sell', 'limit', 'superseded', 'user_entry')`)).toBe(false);
    expect(await refused(db, `INSERT INTO orders (user_id, account_id, symbol, side, order_type, status, execution_source) VALUES ('${U}', '${ids.acct}', 'AAA', 'buy', 'limit', 'working', 'user_entry')`)).toBe(true);
  });

  test("an import batch needs a real checksum and a known outcome", async () => {
    expect(await refused(db, `INSERT INTO import_batches (user_id, source, checksum_sha256, outcome) VALUES ('${U}', 'imported', 'nothex', 'staged')`)).toBe(true);
    expect(await refused(db, `INSERT INTO import_batches (user_id, source, outcome) VALUES ('${U}', 'imported', 'done')`)).toBe(true);
    expect(await refused(db, `INSERT INTO import_batches (user_id, source, outcome) VALUES ('${U}', 'ai', 'staged')`)).toBe(true);
    const b = await one<{ id: string }>(db, `INSERT INTO import_batches (user_id, account_id, source, file_name, checksum_sha256, parsed_rows, valid_rows, outcome) VALUES ('${U}', '${ids.acct}', 'imported', 'positions.csv', repeat('a', 64), 12, 12, 'committed') RETURNING id`);
    expect(await refused(db, `INSERT INTO sync_log (user_id, source, status, batch_id) VALUES ('${U}', 'csv', 'ok', '${b.id}')`)).toBe(false);
  });

  test("audit rows cannot be written by the client role — only read", async () => {
    const grants = (await db.query<{ privilege_type: string }>("SELECT privilege_type FROM information_schema.role_table_grants WHERE table_name = 'audit_log' AND grantee = 'authenticated'")).rows.map((r) => r.privilege_type);
    expect(grants).toEqual(["SELECT"]);
  });
});
