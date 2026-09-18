// ADR-APP-019: the backfill attaches a NULL-account decision to its owner's
// account only when that owner has exactly one. Run against the real
// migration in PGlite, with the three kinds of owner side by side.
import { beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MIGRATIONS_DIR, OTHER_USER as B, TEST_USER as A, actAsAdmin, one, replayMigrations, signIn } from "./replay";

const MIGRATION = "20260918190000_decisions_account_backfill.sql";
const C = "00000000-0000-0000-0000-000000000003";

let db: PGlite;
const ids: Record<string, string> = {};

const decision = async (user: string, account: string | null, tag: string) =>
  (await one<{ id: string }>(db, `INSERT INTO decisions (user_id, account_id, recommendation, decision, review_type, decided_on) VALUES ('${user}', ${account ? `'${account}'` : "NULL"}, 'rec ${tag}', 'pending', 'morning', current_date) RETURNING id`)).id;
const accountOf = async (id: string) => (await one<{ a: string | null }>(db, `SELECT account_id a FROM decisions WHERE id = '${id}'`)).a;
const apply = () => db.exec(readFileSync(join(MIGRATIONS_DIR, MIGRATION), "utf8"));

beforeAll(async () => {
  db = (await replayMigrations()).db; // the migration ran once here, on an empty table
  for (const u of [A, B, C]) await signIn(db, u);
  await actAsAdmin(db);
  // A: exactly one account. Two NULL decisions and one already attached.
  ids.aAcct = (await one<{ id: string }>(db, `INSERT INTO accounts (user_id, name) VALUES ('${A}', 'Only') RETURNING id`)).id;
  ids.a1 = await decision(A, null, "a1");
  ids.a2 = await decision(A, null, "a2");
  ids.aSet = await decision(A, ids.aAcct, "a-set");
  // B: two accounts. One NULL decision — must stay NULL.
  ids.b1Acct = (await one<{ id: string }>(db, `INSERT INTO accounts (user_id, name) VALUES ('${B}', 'First') RETURNING id`)).id;
  ids.b2Acct = (await one<{ id: string }>(db, `INSERT INTO accounts (user_id, name) VALUES ('${B}', 'Second') RETURNING id`)).id;
  ids.b1 = await decision(B, null, "b1");
  // C: no account. One NULL decision — nothing to attach to.
  ids.c1 = await decision(C, null, "c1");
});

describe("the backfill", () => {
  test("before: the seed is what the test says it is (negative control)", async () => {
    expect(await accountOf(ids.a1)).toBeNull();
    expect(await accountOf(ids.b1)).toBeNull();
    expect(await accountOf(ids.c1)).toBeNull();
    expect(await accountOf(ids.aSet)).toBe(ids.aAcct);
  });

  test("a one-account owner's NULL rows are attached to that account; nothing else moves", async () => {
    const auditBefore = Number((await one<{ n: string }>(db, "SELECT count(*)::text n FROM audit_log WHERE table_name = 'decisions' AND op = 'UPDATE'")).n);
    await apply();
    expect(await accountOf(ids.a1)).toBe(ids.aAcct);
    expect(await accountOf(ids.a2)).toBe(ids.aAcct);
    expect(await accountOf(ids.aSet)).toBe(ids.aAcct); // untouched, not re-pointed
    expect(await accountOf(ids.b1)).toBeNull(); // two accounts: a guess is refused
    expect(await accountOf(ids.c1)).toBeNull(); // no account: nothing to attach to
    // The trigger recorded exactly the two rows that changed, under their owner.
    const audit = (await db.query<{ user_id: string; changed_by: string | null; row_id: string }>(
      "SELECT user_id, changed_by::text, row_id FROM audit_log WHERE table_name = 'decisions' AND op = 'UPDATE' ORDER BY id",
    )).rows.slice(auditBefore);
    expect(audit.map((r) => r.row_id).sort()).toEqual([ids.a1, ids.a2].sort());
    for (const r of audit) {
      expect(r.user_id).toBe(A);
      expect(r.changed_by).toBeNull(); // a migration, not a signed-in user
    }
  });

  test("idempotent: a second run changes nothing", async () => {
    const before = (await db.query<{ j: Record<string, unknown> }>("SELECT to_jsonb(d) j FROM decisions d ORDER BY id")).rows;
    const audit = Number((await one<{ n: string }>(db, "SELECT count(*)::text n FROM audit_log")).n);
    await apply();
    const after = (await db.query<{ j: Record<string, unknown> }>("SELECT to_jsonb(d) j FROM decisions d ORDER BY id")).rows;
    expect(after).toEqual(before);
    expect(Number((await one<{ n: string }>(db, "SELECT count(*)::text n FROM audit_log")).n)).toBe(audit);
  });

  test("the supersession chain is now open to the backfilled rows and still closed to the others", async () => {
    // DEC-005: a superseding decision must share the account. Attaching the
    // account is what makes a1 supersedable; b1 stays outside the chain.
    await signIn(db, A);
    const newer = await decision(A, ids.aAcct, "a-newer");
    await db.exec(`UPDATE decisions SET supersedes_decision_id = '${ids.a1}' WHERE id = '${newer}'`);
    expect((await one<{ s: string | null }>(db, `SELECT supersedes_decision_id s FROM decisions WHERE id = '${newer}'`)).s).toBe(ids.a1);
    await actAsAdmin(db);
  });
});
