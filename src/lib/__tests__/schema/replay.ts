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
    -- Supabase's ambient privileges, modelled so the tests cannot pass for the
    -- wrong reason. In a Supabase project every table, sequence and function
    -- created in \`public\` is granted ALL to anon / authenticated / service_role
    -- by default privileges; a GRANT in a migration therefore narrows nothing,
    -- and ROW LEVEL SECURITY is the only thing between one user's rows and
    -- another's. Without this stub a missing GRANT would make a cross-user
    -- read fail with "permission denied", and a test would pass on a table
    -- whose policy is wrong.
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
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

/** A second user. Every row of theirs is a row `TEST_USER` must not see. */
export const OTHER_USER = "00000000-0000-0000-0000-000000000002";

export type DbRole = "authenticated" | "anon" | "service_role";

/**
 * Become a role the way PostgREST does: the Postgres role the JWT maps to, and
 * the `sub` claim `auth.uid()` reads. Unlike `signIn`, this leaves the
 * superuser — RLS does not apply to the table owner, so a test that never
 * switches role is not testing RLS at all.
 */
export async function actAs(db: PGlite, role: DbRole, userId: string | null): Promise<void> {
  await db.exec("RESET ROLE;");
  if (userId !== null) {
    await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${userId}', '${userId.slice(-4)}@example.com') ON CONFLICT DO NOTHING;`);
  }
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${userId ?? ""}', false);`);
  await db.exec(`SELECT set_config('request.jwt.claim.role', '${role}', false);`);
  await db.exec(`SET ROLE ${role};`);
}

/** Back to the superuser (the migrations' author), who bypasses RLS. */
export async function actAsAdmin(db: PGlite): Promise<void> {
  await db.exec("RESET ROLE;");
  await db.exec("SELECT set_config('request.jwt.claim.sub', '', false);");
  await db.exec("SELECT set_config('request.jwt.claim.role', '', false);");
}

/**
 * How many rows a write touched, or `"refused"` when it errored. RLS makes an
 * UPDATE or DELETE of another user's rows touch zero rows silently, and makes
 * an INSERT or an ownership change error; both are the right answer, and the
 * caller says which it expects.
 */
export async function affected(db: PGlite, writeSql: string): Promise<number | "refused"> {
  try {
    const r = await db.query(`${writeSql} RETURNING 1`);
    return r.rows.length;
  } catch {
    return "refused";
  }
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
