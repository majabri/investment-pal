// Alerts persisted with acknowledgement (§23.1), run for real.
import { beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ALERT_TYPES } from "@/lib/alerts";
import { MIGRATIONS_DIR, TEST_USER as U, one, refused, replayMigrations, signIn } from "./replay";

const MIGRATION = "20260917180000_alerts.sql";

let db: PGlite;
let acct: string;

const alert = (fp: string, over: Partial<{ type: string; severity: string; message: string; href: string }> = {}) => ({
  type: "stale_quote",
  severity: "warning",
  message: `Positions were last imported ${fp} days ago.`,
  href: "/settings",
  // The identity never carries the figure; only the message does.
  fingerprint: "stale_quote:positions-#-days",
  ...over,
});

const raise = async (alerts: unknown[], accountId: string | null = acct) =>
  (await one<{ r: Record<string, number> }>(db, `SELECT public.raise_alerts(${accountId ? `'${accountId}'` : "NULL"}, '${JSON.stringify(alerts).replace(/'/g, "''")}'::jsonb) r`)).r;

const open = async () =>
  (await db.query<{ fingerprint: string; acknowledged_at: string | null; resolved_at: string | null; message: string }>(
    `SELECT fingerprint, acknowledged_at, resolved_at, message FROM alerts WHERE account_id = '${acct}' ORDER BY fingerprint`,
  )).rows;

const events = async () => Number((await one<{ n: string }>(db, "SELECT count(*)::text n FROM domain_events WHERE event_type = 'AlertRaised'")).n);

beforeAll(async () => {
  const r = await replayMigrations();
  db = r.db;
  await signIn(db);
  acct = (await one<{ id: string }>(db, `INSERT INTO accounts (user_id, name) VALUES ('${U}', 'Test') RETURNING id`)).id;
});

describe("the migration", () => {
  test("applies twice to the same state, and record_change now covers ten tables", async () => {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, MIGRATION), "utf8"));
    const n = await one<{ n: string }>(db, "SELECT count(*)::text n FROM pg_trigger WHERE tgname LIKE 'trg_%_record_change'");
    expect(Number(n.n)).toBe(10);
  });

  test("the CHECK admits exactly the eleven §23.1 names lib/alerts.ts lists", async () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, MIGRATION), "utf8");
    for (const t of ALERT_TYPES) expect(sql).toContain(`'${t}'`);
    expect(await refused(db, `INSERT INTO alerts (user_id, type, severity, message, href, fingerprint) VALUES ('${U}', 'something_else', 'info', 'x', '/x', 'f')`)).toBe(true);
    expect(await refused(db, `INSERT INTO alerts (user_id, type, severity, message, href, fingerprint) VALUES ('${U}', 'stale_quote', 'loud', 'x', '/x', 'f')`)).toBe(true);
    expect(await refused(db, `INSERT INTO alerts (user_id, type, severity, message, href, fingerprint) VALUES ('${U}', 'stale_quote', 'info', '', '/x', 'f')`)).toBe(true);
  });
});

describe("raise_alerts: the lifecycle", () => {
  test("a first evaluation raises each alert once, and each raises AlertRaised", async () => {
    const before = await events();
    const r = await raise([alert("3"), alert("x", { type: "goal_pace", message: "Probability of reaching the goal is 42%.", href: "/goals", fingerprint: "goal_pace:probability-#" })]);
    expect(r).toEqual({ raised: 2, reraised: 0, refreshed: 0, resolved: 0 });
    expect((await open()).map((a) => a.resolved_at)).toEqual([null, null]);
    expect(await events()).toBe(before + 2);
  });

  test("the same set again refreshes: wording may move, nothing is new, no event", async () => {
    const before = await events();
    const r = await raise([alert("4"), alert("x", { type: "goal_pace", message: "Probability of reaching the goal is 41%.", href: "/goals", fingerprint: "goal_pace:probability-#" })]);
    expect(r).toEqual({ raised: 0, reraised: 0, refreshed: 2, resolved: 0 });
    expect((await open()).find((a) => a.fingerprint.startsWith("stale"))!.message).toContain("4 days");
    expect(await events()).toBe(before);
  });

  test("acknowledging is the holder's own update and raises nothing", async () => {
    const before = await events();
    await db.exec(`UPDATE alerts SET acknowledged_at = now() WHERE fingerprint = 'stale_quote:positions-#-days' AND user_id = '${U}'`);
    expect((await open()).find((a) => a.fingerprint.startsWith("stale"))!.acknowledged_at).not.toBeNull();
    expect(await events()).toBe(before);
  });

  test("an evaluation without an alert resolves it; the acknowledgement survives on the still-open one", async () => {
    const r = await raise([alert("5")]);
    expect(r).toEqual({ raised: 0, reraised: 0, refreshed: 1, resolved: 1 });
    const rows = await open();
    expect(rows.find((a) => a.fingerprint.startsWith("goal"))!.resolved_at).not.toBeNull();
    expect(rows.find((a) => a.fingerprint.startsWith("stale"))!.acknowledged_at).not.toBeNull();
  });

  test("a resolved alert that comes back is a NEW occurrence: unacknowledged, and AlertRaised again", async () => {
    await db.exec(`UPDATE alerts SET acknowledged_at = now() WHERE user_id = '${U}'`); // acknowledge everything, resolved included
    const before = await events();
    const r = await raise([alert("6"), alert("x", { type: "goal_pace", message: "Probability of reaching the goal is 40%.", href: "/goals", fingerprint: "goal_pace:probability-#" })]);
    expect(r).toEqual({ raised: 0, reraised: 1, refreshed: 1, resolved: 0 });
    const rows = await open();
    expect(rows.find((a) => a.fingerprint.startsWith("goal"))!.acknowledged_at).toBeNull();
    expect(rows.find((a) => a.fingerprint.startsWith("goal"))!.resolved_at).toBeNull();
    // NEGATIVE CONTROL: the one that never resolved keeps its acknowledgement.
    expect(rows.find((a) => a.fingerprint.startsWith("stale"))!.acknowledged_at).not.toBeNull();
    expect(await events()).toBe(before + 1);
  });

  test("scopes are separate: the household and an account hold their own rows", async () => {
    const r = await raise([alert("7")], null);
    expect(r.raised).toBe(1);
    const n = await one<{ n: string }>(db, `SELECT count(*)::text n FROM alerts WHERE user_id = '${U}' AND scope_key = 'household'`);
    expect(Number(n.n)).toBe(1);
    // NEGATIVE CONTROL: raising for the household resolved nothing on the account.
    expect((await open()).every((a) => a.resolved_at === null)).toBe(true);
  });

  test("an empty evaluation resolves everything open in that scope", async () => {
    const r = await raise([]);
    expect(r.resolved).toBe(2);
    expect((await open()).every((a) => a.resolved_at !== null)).toBe(true);
  });

  test("refusals: not a JSON array; an account that is not the caller's", async () => {
    expect(await refused(db, `SELECT public.raise_alerts('${acct}', '{}'::jsonb)`)).toBe(true);
    expect(await refused(db, `SELECT public.raise_alerts(gen_random_uuid(), '[]'::jsonb)`)).toBe(true);
  });
});
