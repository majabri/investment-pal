// Per-consumer cursors over the outbox (ADR-APP-018, option 2; migration
// 20260918210000), exercised in PGlite before Lovable sees it.
//
// The rules the migration holds, each with its negative control:
//   * a consumer registers at the present (the owner's latest event id);
//   * its cursor never moves backwards;
//   * its cursor never moves past an event that does not exist;
//   * consumed_at is set only once EVERY registered consumer has passed it;
//   * the client role reads its cursors and writes them only through the RPCs;
//   * another user's cursor and events are out of reach.
// Symbols and figures are placeholders.
import { beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MIGRATIONS_DIR, OTHER_USER as B, TEST_USER as A, actAs, actAsAdmin, affected, one, refused, replayMigrations } from "./replay";

const MIGRATION = "20260918210000_event_consumers.sql";

let db: PGlite;
let acct = "";

const n = async (sql: string) => Number((await one<{ v: string }>(db, `SELECT (SELECT ${sql})::text v`)).v);
const raise = async () => {
  // One HoldingsReconciled event for A, raised by the trigger as the app would.
  await db.exec(`INSERT INTO holdings (user_id, account_id, symbol, quantity, cost_basis, current_price) VALUES ('${A}', '${acct}', 'SYM' || floor(random() * 100000)::int, 1, 1, 1)`);
  return n(`max(id) FROM domain_events WHERE user_id = '${A}'`);
};
const consumedAt = async (id: number) => (await one<{ c: string | null }>(db, `SELECT consumed_at::text c FROM domain_events WHERE id = ${id}`)).c;
const cursor = async (name: string) => n(`last_event_id FROM event_consumers WHERE user_id = '${A}' AND name = '${name}'`);

beforeAll(async () => {
  db = (await replayMigrations()).db;
  await actAs(db, "authenticated", A);
  acct = (await one<{ id: string }>(db, `INSERT INTO accounts (user_id, name) VALUES ('${A}', 'Acct') RETURNING id`)).id;
  await actAsAdmin(db);
});

describe("the migration", () => {
  test("applies twice to the same state", async () => {
    await actAsAdmin(db);
    const before = await one<{ c: string }>(db, "SELECT count(*)::text c FROM pg_policies WHERE tablename = 'event_consumers'");
    await db.exec(readFileSync(join(MIGRATIONS_DIR, MIGRATION), "utf8"));
    const after = await one<{ c: string }>(db, "SELECT count(*)::text c FROM pg_policies WHERE tablename = 'event_consumers'");
    expect(after.c).toBe(before.c);
    expect(before.c).toBe("1");
  });

  test("catalog: RLS on, one SELECT policy scoped by auth.uid(), both CHECKs present", async () => {
    expect((await one<{ on: boolean }>(db, "SELECT relrowsecurity \"on\" FROM pg_class WHERE relname = 'event_consumers'")).on).toBe(true);
    const p = await one<{ cmd: string; qual: string }>(db, "SELECT cmd, qual FROM pg_policies WHERE tablename = 'event_consumers'");
    expect(p.cmd).toBe("SELECT");
    expect(p.qual).toContain("auth.uid()");
    const checks = (await db.query<{ conname: string }>("SELECT conname FROM pg_constraint WHERE conrelid = 'public.event_consumers'::regclass AND contype = 'c' ORDER BY 1")).rows.map((r) => r.conname);
    expect(checks).toEqual(["event_consumers_cursor", "event_consumers_name"]);
  });

  test("grants: the client reads its cursors and nothing else; anon has nothing; the outbox lost its direct UPDATE", async () => {
    const priv = async (role: string, table: string, p: string) => (await one<{ ok: boolean }>(db, `SELECT has_table_privilege('${role}', 'public.${table}', '${p}') ok`)).ok;
    expect(await priv("authenticated", "event_consumers", "SELECT")).toBe(true);
    for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) expect([p, await priv("authenticated", "event_consumers", p)]).toEqual([p, false]);
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) expect([p, await priv("anon", "event_consumers", p)]).toEqual([p, false]);
    expect(await priv("authenticated", "domain_events", "UPDATE")).toBe(false);
    expect(await priv("authenticated", "domain_events", "SELECT")).toBe(true);
    const fn = async (role: string, sig: string) => (await one<{ ok: boolean }>(db, `SELECT has_function_privilege('${role}', 'public.${sig}', 'EXECUTE') ok`)).ok;
    for (const sig of ["register_event_consumer(text)", "advance_event_cursor(text, bigint)"]) {
      expect([sig, await fn("authenticated", sig)]).toEqual([sig, true]);
      expect([sig, await fn("anon", sig)]).toEqual([sig, false]);
    }
  });
});

describe("register_event_consumer", () => {
  test("a new consumer starts at the owner's latest event; registering again returns the same cursor", async () => {
    await actAsAdmin(db);
    const before = await raise();
    await actAs(db, "authenticated", A);
    expect(await n("register_event_consumer('goal_cache')")).toBe(before);
    // History before registration is passed by declaration, not re-read.
    expect(await n("register_event_consumer('goal_cache')")).toBe(before);
    await actAsAdmin(db);
    expect(await cursor("goal_cache")).toBe(before);
    expect(await n(`count(*) FROM event_consumers WHERE user_id = '${A}' AND name = 'goal_cache'`)).toBe(1);
  });

  test("a user with no events registers at 0 — a real zero, not an error", async () => {
    await actAs(db, "authenticated", B);
    expect(await n("register_event_consumer('goal_cache')")).toBe(0);
    await actAsAdmin(db);
  });

  test("refuses a name that is not lower snake_case, and refuses unsigned callers", async () => {
    await actAs(db, "authenticated", A);
    expect(await refused(db, "SELECT register_event_consumer('Goal Cache')")).toBe(true);
    expect(await refused(db, "SELECT register_event_consumer('x')")).toBe(true);
    await actAs(db, "anon", null);
    expect(await refused(db, "SELECT register_event_consumer('goal_cache')")).toBe(true);
    await actAsAdmin(db);
  });
});

describe("advance_event_cursor", () => {
  let e1 = 0;
  let e2 = 0;

  test("advances to an event that exists and marks it consumed when it is the only consumer", async () => {
    await actAsAdmin(db);
    e1 = await raise();
    await actAs(db, "authenticated", A);
    // The consumer sees exactly the events past its cursor.
    const c = await n("register_event_consumer('goal_cache')");
    expect(await n(`count(*) FROM domain_events WHERE id > ${c}`)).toBe(1);
    expect(await n(`advance_event_cursor('goal_cache', ${e1})`)).toBe(e1);
    await actAsAdmin(db);
    expect(await cursor("goal_cache")).toBe(e1);
    expect(await consumedAt(e1)).not.toBeNull();
  });

  test("never moves backwards: an older position returns the current cursor unchanged", async () => {
    await actAs(db, "authenticated", A);
    expect(await n(`advance_event_cursor('goal_cache', ${e1 - 1})`)).toBe(e1);
    expect(await n("advance_event_cursor('goal_cache', 0)")).toBe(e1);
    await actAsAdmin(db);
    expect(await cursor("goal_cache")).toBe(e1);
  });

  test("never moves past the last event that exists", async () => {
    await actAs(db, "authenticated", A);
    expect(await refused(db, `SELECT advance_event_cursor('goal_cache', ${e1 + 1})`)).toBe(true);
    expect(await refused(db, "SELECT advance_event_cursor('goal_cache', -1)")).toBe(true);
    await actAsAdmin(db);
    expect(await cursor("goal_cache")).toBe(e1); // negative control: the refusal changed nothing
  });

  test("an unregistered consumer cannot advance", async () => {
    await actAs(db, "authenticated", A);
    expect(await refused(db, `SELECT advance_event_cursor('never_registered', ${e1})`)).toBe(true);
    await actAsAdmin(db);
  });

  test("consumed_at waits for EVERY registered consumer, not the first", async () => {
    await actAsAdmin(db);
    await actAs(db, "authenticated", A);
    // A second consumer registers now, at e1 — then a new event arrives.
    expect(await n("register_event_consumer('outcome_probe')")).toBe(e1);
    await actAsAdmin(db);
    e2 = await raise();
    expect(e2).toBeGreaterThan(e1);
    await actAs(db, "authenticated", A);
    expect(await n(`advance_event_cursor('goal_cache', ${e2})`)).toBe(e2);
    await actAsAdmin(db);
    // The first consumer has passed e2; the second has not. Not consumed.
    expect(await consumedAt(e2)).toBeNull();
    await actAs(db, "authenticated", A);
    expect(await n(`advance_event_cursor('outcome_probe', ${e2})`)).toBe(e2);
    await actAsAdmin(db);
    expect(await consumedAt(e2)).not.toBeNull();
  });

  test("the client cannot write a cursor or the outbox directly", async () => {
    await actAs(db, "authenticated", A);
    expect(await affected(db, `UPDATE event_consumers SET last_event_id = 0 WHERE user_id = '${A}'`)).toBe("refused");
    expect(await affected(db, `INSERT INTO event_consumers (user_id, name) VALUES ('${A}', 'planted')`)).toBe("refused");
    expect(await affected(db, `DELETE FROM event_consumers WHERE user_id = '${A}'`)).toBe("refused");
    expect(await affected(db, `UPDATE domain_events SET consumed_at = NULL WHERE id = ${e2}`)).toBe("refused");
    // Negative control: reading its own cursors is allowed.
    expect(await n(`count(*) FROM event_consumers WHERE user_id = '${A}'`)).toBe(2);
    await actAsAdmin(db);
  });

  test("another user sees none of A's cursors and cannot move A's events by naming their ids", async () => {
    await actAs(db, "authenticated", B);
    expect(await n("count(*) FROM event_consumers")).toBe(1); // B's own goal_cache only
    expect(await n(`count(*) FROM event_consumers WHERE user_id = '${A}'`)).toBe(0);
    // B has no events, so A's ids are past B's last event: refused, and A's rows untouched.
    expect(await refused(db, `SELECT advance_event_cursor('goal_cache', ${e2})`)).toBe(true);
    await actAsAdmin(db);
    expect(await cursor("goal_cache")).toBe(e2);
    expect(await n(`count(*) FROM domain_events WHERE user_id = '${A}' AND consumed_at IS NULL`)).toBe(0);
  });
});
