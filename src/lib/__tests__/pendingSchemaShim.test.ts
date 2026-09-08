// The temporary schema shim in `supabaseClient.ts` has a removal condition and
// nothing watching it. This test is that watcher.
//
// Lovable regenerated `src/integrations/supabase/types.ts` against the LIVE
// database on 2026-09-08. The live database is behind the repo — the seventeen
// migrations under `supabase/migrations/20260903*`–`20260905*` have not been
// applied — so the regenerated types lost the five tables those migrations
// create, and the code that already targets the new schema stopped
// type-checking. The shim restores it: it declares the pending tables loosely
// and, to absorb the new provenance and nullable columns, drops `accounts` and
// `goals` to `Insert: Record<string, unknown>` / `Update: Record<string,
// unknown>`.
//
// That last part is the reason this file exists. `accounts` and `goals` carry
// financial values, and while the shim stands a misspelt column in a write to
// either one is no longer a compile error. That is an acceptable price for a
// stopgap and an unacceptable one for a permanent fixture — and the only thing
// currently distinguishing the two is somebody remembering. The comment above
// the shim says "Remove it once the migrations land and types.ts regenerates";
// this makes the repo say it too, at the moment it becomes true rather than
// whenever someone next reads that comment.
//
// WHAT THIS IS: a source guard, not a schema check. It reads two files as text.
// It cannot reach the live database, cannot tell you whether a migration
// applied cleanly, and cannot see a column added to a table that already
// exists — only whole tables appearing in the generated types. A migration that
// only ALTERs `accounts` will land without tripping it.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const CLIENT = "src/lib/supabaseClient.ts";
const TYPES = "src/integrations/supabase/types.ts";

const clientSrc = readFileSync(CLIENT, "utf8");
const typesSrc = readFileSync(TYPES, "utf8");

/** Tables the shim declares as pending: `  household_members: PendingTable;` */
function pendingTables(src: string): string[] {
  return [...src.matchAll(/^\s+([a-z_]+): PendingTable;$/gm)].map((m) => m[1]);
}

/** Tables in the generated `Tables: { … }` block, which mirrors the live DB. */
function generatedTables(src: string): string[] {
  const start = src.indexOf("    Tables: {");
  if (start === -1) throw new Error(`no Tables block in ${TYPES}`);
  const end = src.indexOf("\n    Views: {", start);
  const block = src.slice(start, end === -1 ? undefined : end);
  return [...block.matchAll(/^ {6}([a-z_]+): \{$/gm)].map((m) => m[1]);
}

const pending = pendingTables(clientSrc);
const generated = generatedTables(typesSrc);
const shimPresent = pending.length > 0;

describe("the parsers actually parse", () => {
  // Without these, every assertion below passes by finding nothing.
  test("the generated types yield a table this repo has always had", () => {
    expect(generated).toContain("accounts");
    expect(generated).toContain("goals");
  });

  test("the generated-table parser is scoped to Tables, not Functions", () => {
    // `consume_provider_request_limit` is a Function and sits at the same
    // indentation. If it shows up here the block slice is wrong and the
    // staleness check below is reading the wrong list.
    expect(generated).not.toContain("consume_provider_request_limit");
  });

  test("the shim parser distinguishes a declaration from the prose above it", () => {
    // The comment names the same tables. Matching prose would make the shim
    // look present forever, including after it is deleted.
    const commentOnly = clientSrc.slice(0, clientSrc.indexOf("type GeneratedTables"));
    expect(pendingTables(commentOnly)).toEqual([]);
  });
});

describe("the shim is still needed", () => {
  test("every table it declares is still missing from the generated types", () => {
    if (!shimPresent) return; // covered by the removal case below
    const landed = pending.filter((t) => generated.includes(t));
    expect({
      landed,
      hint:
        landed.length > 0
          ? `Migrations for ${landed.join(", ")} have been applied and the types ` +
            `regenerated. Remove the schema shim from ${CLIENT} — while it stands, ` +
            `writes to accounts and goals are not type-checked — and delete this file.`
          : "none",
    }).toEqual({ landed: [], hint: "none" });
  });

  test("it declares the five tables the pending migrations create", () => {
    if (!shimPresent) return;
    // Not an exhaustive list of what is pending: account_balances is also
    // declared, and its migration (20260903030000) predates the other four.
    expect(pending).toContain("household_members");
    expect(pending).toContain("strategies");
    expect(pending).toContain("strategy_symbols");
    expect(pending).toContain("orders");
    expect(pending).toContain("position_lots");
  });
});

describe("when the shim goes, the loosening goes with it", () => {
  test("no LooseWrite survives the shim's removal", () => {
    if (shimPresent) return;
    // Deleting the pending-table lines but leaving `accounts: LooseWrite<…>`
    // would silence this file's other tests while keeping the write typing on
    // the financial tables switched off — the exact failure it exists to catch.
    expect(clientSrc).not.toContain("LooseWrite");
  });
});
