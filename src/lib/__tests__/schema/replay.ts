// A disposable Postgres for the test suite (§26.1 "schema/migration",
// §27.2 "migration validation").
//
// PGlite is Postgres compiled to WebAssembly, so the migrations run in the
// engine that will run them in production, without a server. Supabase's
// ambient objects — the `auth` schema, `auth.uid()`, and the three roles the
// GRANT statements name — are stubbed here to what the migrations expect of
// them and nothing more.
//
// Lovable re-applied several early migrations under its own timestamps, and
// not every copy was idempotent (a CREATE POLICY without IF NOT EXISTS). In
// production each ran once. On replay the copy fails with "already exists",
// which is the same state, so that one error class is tolerated and COUNTED;
// any other failure is a failure.
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

/** A user id every fixture shares. Nothing about it is real. */
export const TEST_USER = "00000000-0000-0000-0000-000000000001";

export type Replay = {
  db: PGlite;
  applied: string[];
  /** Files that only failed with "already exists" — Lovable's duplicates. */
  duplicates: string[];
};

export async function freshDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text,
      raw_user_meta_data jsonb,
      created_at timestamptz DEFAULT now()
    );
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
    END $$;
  `);
  return db;
}

export function migrationFiles(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** Apply every migration in filename order. Throws on the first real failure. */
export async function replayMigrations(dir: string = MIGRATIONS_DIR): Promise<Replay> {
  const db = await freshDatabase();
  const applied: string[] = [];
  const duplicates: string[] = [];
  for (const f of migrationFiles(dir)) {
    const sql = readFileSync(join(dir, f), "utf8");
    try {
      await db.exec(sql);
      applied.push(f);
    } catch (e) {
      const err = e as Error;
      if (/already exists/.test(err.message)) {
        duplicates.push(f);
        continue;
      }
      throw new Error(`${f}: ${err.message}`);
    }
  }
  return { db, applied, duplicates };
}

/** Act as `TEST_USER` for RLS-aware functions (`auth.uid()`). */
export async function signIn(db: PGlite, userId: string = TEST_USER): Promise<void> {
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${userId}', 'test@example.com') ON CONFLICT DO NOTHING;`);
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${userId}', false);`);
}

/** The first row of a query, typed by the caller. */
export async function one<T>(db: PGlite, sql: string): Promise<T> {
  const r = await db.query<T>(sql);
  if (r.rows.length === 0) throw new Error(`no row: ${sql}`);
  return r.rows[0];
}

/** Whether a statement is refused. Any error counts: the CHECKs are the point. */
export async function refused(db: PGlite, sql: string): Promise<boolean> {
  try {
    await db.exec(sql);
    return false;
  } catch {
    return true;
  }
}
