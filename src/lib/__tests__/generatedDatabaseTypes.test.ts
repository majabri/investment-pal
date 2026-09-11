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

// ---------------------------------------------------------------------------
// The blind spot this file admits to, now closed.
// ---------------------------------------------------------------------------
//
// The guard above reads ONE file and says so: "a loosening introduced in
// another module and imported here would not trip it." That blind spot was
// populated. 49 `as never` casts sat across the app — on `.from()` calls, on
// insert payloads, and on RPC names — each one defeating, at a single call
// site, exactly the typing the guard protects at the client.
//
// Every one of them was removable. The tables had existed since Lovable applied
// the migrations; the casts were left over from when they did not. What the
// removal surfaced is the point: an RPC argument whose generated type is wrong,
// a payload builder returning `Record<string, unknown>`, a `user?.id` flowing
// into a NOT NULL column, and an account type too narrow for what it is given.
// None of those was visible while the casts stood.
import { readdirSync } from "node:fs";

/** Every .ts/.tsx under src/, excluding tests. */
function sourceFiles(dir = "src"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Cast sites in one file's text.
 *
 * The word boundary is load-bearing and was got wrong first: a plain search for
 * `as never` matches inside "h-as never" and "w-as never", so ordinary prose —
 * "the app has never asked", "a figure that was never the account's balance" —
 * counts as a cast. That inflated the first count of this defect from 49 to 60
 * and would have made this guard fire on a comment.
 */
export function castSites(src: string): string[] {
  return src
    .split("\n")
    .filter((line) => /(?<![A-Za-z])as never\b/.test(line))
    .map((line) => line.trim());
}

describe("no call site casts its way past the generated types", () => {
  const files = sourceFiles();

  test("it reads real files", () => {
    // Without this, an empty list passes the assertion below vacuously.
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain("src/hooks/useAppData.ts");
  });

  test("NEGATIVE CONTROL: the matcher finds a cast and ignores prose", () => {
    expect(castSites('const x = y as never;')).toHaveLength(1);
    expect(castSites('.from("cash_flows" as never)')).toHaveLength(1);
    // The three spellings that broke the first count.
    expect(castSites("// the app has never asked")).toEqual([]);
    expect(castSites("// a figure that was never the balance")).toEqual([]);
    expect(castSites("/** Never 0 for an account that has never been imported. */")).toEqual([]);
  });

  test("no source file outside this guard carries one", () => {
    const offenders: string[] = [];
    for (const f of files) {
      // dbRows.ts documents the pattern it replaced, in prose that names it.
      if (f === "src/lib/dbRows.ts") continue;
      const hits = castSites(readFileSync(f, "utf8"));
      for (const h of hits) offenders.push(`${f}: ${h}`);
    }
    // A cast here is not automatically wrong — it is a claim that the generated
    // types are wrong, which is sometimes true. It has to be argued at the site
    // and allowed here deliberately, rather than reached for by habit.
    expect(offenders).toEqual([]);
  });
});
