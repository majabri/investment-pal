// The vocabulary in TypeScript and the CHECK constraint in Postgres have to
// agree, and nothing enforces that at build time.
//
// The failure mode is specific and bad: a value the UI offers but the constraint
// rejects does not fail here, or in CI, or on boot. It fails when a user picks
// it and presses Save — in production, as a database error, on a screen whose
// only job is recording what an account is.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_SOURCES,
  ACCOUNT_STATUSES,
  TAX_TREATMENTS,
  accountTypeIsConfirmed,
} from "../accountMetadata";

const MIGRATION = "supabase/migrations/20260905210000_account_metadata.sql";

/** The quoted values of one `column IN (...)` list in the CHECK constraint. */
function constraintValues(column: string): string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const m = new RegExp(`${column} IN\\s*\\(([^)]*)\\)`).exec(sql);
  if (!m) throw new Error(`no IN (...) list for ${column} in ${MIGRATION}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("the type vocabulary matches what the database will accept", () => {
  const cases: Array<[string, readonly string[]]> = [
    ["account_type", ACCOUNT_TYPES],
    ["account_type_source", ACCOUNT_TYPE_SOURCES],
    ["tax_treatment", TAX_TREATMENTS],
    ["account_status", ACCOUNT_STATUSES],
  ];

  for (const [column, values] of cases) {
    test(`${column}: every value the app offers is accepted`, () => {
      const allowed = constraintValues(column);
      for (const v of values) expect(allowed).toContain(v);
    });

    test(`${column}: the constraint allows nothing the app cannot produce`, () => {
      // The other direction matters too. A value only the database knows about
      // is a value no screen can set and no screen expects to read.
      expect([...constraintValues(column)].sort()).toEqual([...values].sort());
    });
  }
});

describe("the two categories the name-matcher could see are now recordable", () => {
  test("529 and crypto are types, not name patterns", () => {
    // The old classifier read /529/ and /crypto/i off the account NAME. Without
    // these two values the metadata could not express what it expressed, and
    // dropping the name-matching would have lost the categories.
    expect(ACCOUNT_TYPES as readonly string[]).toContain("529");
    expect(ACCOUNT_TYPES as readonly string[]).toContain("crypto");
  });

  test("main's existing values all survive", () => {
    // Replacing them with the brief's coarser set would have made every
    // existing account fail the new CHECK on the next Save.
    const mainsValues = [
      "brokerage",
      "ira",
      "roth_ira",
      "401k",
      "hsa",
      "custodial",
      "trust",
      "cash",
      "other",
    ];
    for (const t of mainsValues) expect(ACCOUNT_TYPES as readonly string[]).toContain(t);
  });
});

describe("a stored type is not the same as an answered one", () => {
  test("the app's own guesses do not count as confirmed", () => {
    expect(accountTypeIsConfirmed("inferred_from_name")).toBe(false);
    // The one that matters most: legacy_default means a schema default said
    // "taxable brokerage", which is a claim about tax treatment nobody made.
    expect(accountTypeIsConfirmed("legacy_default")).toBe(false);
  });

  test("only a person's answer counts", () => {
    expect(accountTypeIsConfirmed("user_set")).toBe(true);
    expect(accountTypeIsConfirmed("imported")).toBe(true);
  });

  test("an absent source is not confirmed", () => {
    expect(accountTypeIsConfirmed(null)).toBe(false);
    expect(accountTypeIsConfirmed(undefined)).toBe(false);
  });
});
