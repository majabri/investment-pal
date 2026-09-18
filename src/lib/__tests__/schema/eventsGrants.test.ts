// The client roles' privileges on the event record and the audit log, as
// the catalog holds them (§19.2, §24). Production showed `authenticated` and
// `anon` with ALL on both tables via Supabase's default privileges; the
// column grant in 20260917150000 had narrowed nothing. This asserts the
// surface 20260918170000 leaves, under the replay's model of those defaults.
import { beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MIGRATIONS_DIR, OTHER_USER as B, TEST_USER as A, actAs, actAsAdmin, affected, one, replayMigrations } from "./replay";

const MIGRATION = "20260918170000_events_audit_grants.sql";

let db: PGlite;

const tablePriv = async (role: string, table: string, priv: string) =>
  (await one<{ ok: boolean }>(db, `SELECT has_table_privilege('${role}', 'public.${table}', '${priv}') ok`)).ok;
const columnPriv = async (role: string, table: string, column: string, priv: string) =>
  (await one<{ ok: boolean }>(db, `SELECT has_column_privilege('${role}', 'public.${table}', '${column}', '${priv}') ok`)).ok;

beforeAll(async () => {
  db = (await replayMigrations()).db;
  await actAsAdmin(db);
});

describe("the migration", () => {
  test("applies twice to the same state", async () => {
    const before = await tablePriv("authenticated", "domain_events", "INSERT");
    await db.exec(readFileSync(join(MIGRATIONS_DIR, MIGRATION), "utf8"));
    expect(await tablePriv("authenticated", "domain_events", "INSERT")).toBe(before);
    expect(before).toBe(false);
  });

  test("negative control: the replay's model really does grant ALL by default — a fresh table shows it", async () => {
    // Without this, the assertions below could pass on a database where the
    // client roles never had anything to revoke.
    await db.exec("CREATE TABLE public.zz_probe (id int)");
    expect(await tablePriv("authenticated", "zz_probe", "INSERT")).toBe(true);
    expect(await tablePriv("anon", "zz_probe", "TRUNCATE")).toBe(true);
    await db.exec("DROP TABLE public.zz_probe");
  });
});

describe("domain_events: the client reads its own rows and consumes them, nothing else", () => {
  test("authenticated: SELECT yes; INSERT, DELETE, TRUNCATE no; UPDATE only on consumed_at", async () => {
    expect(await tablePriv("authenticated", "domain_events", "SELECT")).toBe(true);
    for (const p of ["INSERT", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      expect([p, await tablePriv("authenticated", "domain_events", p)]).toEqual([p, false]);
    }
    expect(await columnPriv("authenticated", "domain_events", "consumed_at", "UPDATE")).toBe(true);
    for (const c of ["event_type", "payload", "aggregate_id", "user_id", "occurred_at", "audit_id"]) {
      expect([c, await columnPriv("authenticated", "domain_events", c, "UPDATE")]).toEqual([c, false]);
    }
  });
  test("anon: nothing at all", async () => {
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
      expect([p, await tablePriv("anon", "domain_events", p)]).toEqual([p, false]);
    }
  });
  test("service_role keeps ALL (the server side is not the client)", async () => {
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect([p, await tablePriv("service_role", "domain_events", p)]).toEqual([p, true]);
    }
  });
});

describe("audit_log: read-only for the client", () => {
  test("authenticated: SELECT only; anon: nothing", async () => {
    expect(await tablePriv("authenticated", "audit_log", "SELECT")).toBe(true);
    for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
      expect([p, await tablePriv("authenticated", "audit_log", p)]).toEqual([p, false]);
    }
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect([p, await tablePriv("anon", "audit_log", p)]).toEqual([p, false]);
    }
  });
});

describe("behaviour under the narrowed grants", () => {
  test("the trigger still writes both tables, and the owner still consumes their own event", async () => {
    await actAs(db, "authenticated", A);
    const acct = (await one<{ id: string }>(db, `INSERT INTO accounts (user_id, name) VALUES ('${A}', 'Acct') RETURNING id`)).id;
    await db.exec(`INSERT INTO holdings (user_id, account_id, symbol, quantity, cost_basis, current_price) VALUES ('${A}', '${acct}', 'SYMA', 1, 1, 1)`);
    const ev = await one<{ id: string }>(db, "SELECT id::text FROM domain_events WHERE event_type = 'HoldingsReconciled' ORDER BY id DESC LIMIT 1");
    expect(await affected(db, `UPDATE domain_events SET consumed_at = now() WHERE id = ${ev.id}`)).toBe(1);
    // The column the outbox must never let a client rewrite: refused outright, not "0 rows".
    expect(await affected(db, `UPDATE domain_events SET event_type = 'AlertRaised' WHERE id = ${ev.id}`)).toBe("refused");
    expect(await affected(db, `INSERT INTO domain_events (user_id, event_type, aggregate_type, aggregate_id) VALUES ('${A}', 'GoalChanged', 'goals', '${acct}')`)).toBe("refused");
    expect(await affected(db, "DELETE FROM domain_events")).toBe("refused");
    expect(await affected(db, `INSERT INTO audit_log (user_id, table_name, row_id, op, new_row) VALUES ('${A}', 'goals', gen_random_uuid(), 'INSERT', '{}'::jsonb)`)).toBe("refused");
    // Still readable by the owner; still invisible to another user (RLS, unchanged).
    expect(Number((await one<{ n: string }>(db, "SELECT count(*)::text n FROM audit_log")).n)).toBeGreaterThan(0);
    await actAs(db, "authenticated", B);
    expect(Number((await one<{ n: string }>(db, "SELECT count(*)::text n FROM domain_events")).n)).toBe(0);
    await actAsAdmin(db);
  });
});
