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
  unconfirmedAccounts,
  type ClassifiableAccount,
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

describe("which accounts the app is still guessing about", () => {
  const acct = (over: Partial<ClassifiableAccount>): ClassifiableAccount => ({
    id: "a",
    name: "Account",
    account_type: "brokerage",
    account_type_source: "user_set",
    ...over,
  });

  test("a confirmed account is not listed", () => {
    expect(unconfirmedAccounts([acct({ account_type_source: "user_set" })])).toEqual([]);
    expect(unconfirmedAccounts([acct({ account_type_source: "imported" })])).toEqual([]);
  });

  test("a type read off the account name is a guess, not an answer", () => {
    const rows = [acct({ id: "x", account_type_source: "inferred_from_name" })];
    expect(unconfirmedAccounts(rows).map((a) => a.id)).toEqual(["x"]);
  });

  test("a type inherited from the old column default is also a guess", () => {
    // The worse of the two: it means the app treats the account as a TAXABLE
    // BROKERAGE account because a schema default said so.
    const rows = [acct({ id: "y", account_type_source: "legacy_default" })];
    expect(unconfirmedAccounts(rows).map((a) => a.id)).toEqual(["y"]);
  });

  test("an account with no type at all is listed too", () => {
    // Same problem from the user's side — the app does not know what this is —
    // and the same action fixes it. Surfacing only one of the two would leave
    // the other silently wrong.
    const rows = [acct({ id: "z", account_type: null, account_type_source: null })];
    expect(unconfirmedAccounts(rows).map((a) => a.id)).toEqual(["z"]);
  });

  test("it separates a mixed list rather than flagging everything", () => {
    // A banner that fires for every account is a banner nobody reads.
    const rows = [
      acct({ id: "ok1", account_type_source: "user_set" }),
      acct({ id: "guess", account_type_source: "inferred_from_name" }),
      acct({ id: "ok2", account_type_source: "imported" }),
      acct({ id: "default", account_type_source: "legacy_default" }),
    ];
    expect(unconfirmedAccounts(rows).map((a) => a.id)).toEqual(["guess", "default"]);
  });
});

// A guess that can never be promoted to an answer is a guess forever, and the
// "unconfirmed" banner would then be permanent noise on every account. The
// promotion happens in a route file, which the tests project excludes, so this
// asserts it against the source.
describe("saving an account type is what turns a guess into an answer", () => {
  const settings = readFileSync("src/routes/_authenticated/settings.tsx", "utf8");

  test("the account editor records the source as user_set on save", () => {
    expect(settings).toContain('account_type_source: form.account_type ? "user_set" : null');
  });

  test("nothing in the UI writes one of the app's own guesses", () => {
    // `inferred_from_name` and `legacy_default` are the migration's to write,
    // once. A screen writing either would mean the app had re-inferred at
    // runtime, which is the thing rule 4 forbids.
    //
    // Matched as an ASSIGNMENT, not as an occurrence. The first version of this
    // test used `not.toContain("inferred_from_name")` and failed on a
    // comparison that reads the value to decide a tooltip — a guard coarser
    // than the fault it claims to catch, which is the same mistake as a
    // negative control coarser than its fault.
    const writes = /account_type_source:\s*"(inferred_from_name|legacy_default)"/;
    expect(settings).not.toMatch(writes);
    // ...and reading it is not only allowed, it is how the UI knows to ask.
    expect(settings).toContain('account_type_source === "inferred_from_name"');
  });
});
