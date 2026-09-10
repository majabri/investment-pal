// The Supabase client must be typed by the GENERATED database types, unaltered.
//
// This replaces `pendingSchemaShim.test.ts`, which existed to alarm when the
// temporary schema shim went stale. It did that on 2026-09-10, all 24
// migrations were applied, the shim came out, and — per its own instructions —
// that file is gone rather than left behind passing vacuously.
//
// What survives it is the one invariant that outlives the shim. Between
// 2026-09-08 and 2026-09-10 `supabaseClient.ts` declared a local `Database`
// that wrapped the generated one and replaced Insert/Update on `accounts` and
// `goals` with `Record<string, unknown>`. That was a defensible stopgap while
// the generated types lagged the repo, and it also meant a misspelt column in
// a write to either financial table was not a compile error. Nothing about
// today's clean state prevents that pattern returning the next time the types
// lag — a lag that recurs by construction, since Lovable regenerates them from
// the live database.
//
// So: the client takes the generated `Database` directly, and this says so.
//
// WHAT THIS IS: a source guard. It reads one file as text. It cannot see
// whether the generated types match the live database, and a loosening
// introduced in another module and imported here would not trip it.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const CLIENT = "src/lib/supabaseClient.ts";
const src = readFileSync(CLIENT, "utf8");

describe("the Supabase client uses the generated types unaltered", () => {
  test("it reads the file it thinks it does", () => {
    // Without this, every assertion below passes on an empty string.
    expect(src).toContain("@supabase/supabase-js");
    expect(src).toContain("createClient<Database>(");
  });

  test("Database comes straight from the generated module", () => {
    expect(src).toMatch(
      /^import type \{ Database \} from "@\/integrations\/supabase\/types";$/m,
    );
  });

  test("no local Database type re-shapes it", () => {
    // The shim's mechanism: `type Database = Omit<GeneratedDatabase, "public"> & …`.
    // A local declaration of this name is how the generated one gets shadowed.
    expect(src).not.toMatch(/^\s*(?:type|interface)\s+Database\b/m);
  });

  test("no write typing is loosened away", () => {
    // The consequence that mattered: Insert/Update widened to accept anything,
    // on tables holding money.
    expect(src).not.toContain("LooseWrite");
    expect(src).not.toContain("PendingTable");
    expect(src).not.toMatch(/(?:Insert|Update):\s*Record<string, unknown>/);
  });
});
