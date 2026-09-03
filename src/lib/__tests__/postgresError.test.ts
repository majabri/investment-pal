// The one insert failure that is not a failure — and everything that still is.
import { describe, expect, test } from "bun:test";

import { isUniqueViolation, PG_UNIQUE_VIOLATION } from "../postgresError";

describe("isUniqueViolation", () => {
  test("recognises what Supabase returns when the index rejects a duplicate", () => {
    // `portfolio_snapshots` carries a partial unique index on
    // (user_id, account_id, snapshot_date). This is that index doing its job.
    expect(
      isUniqueViolation({
        code: PG_UNIQUE_VIOLATION,
        message:
          'duplicate key value violates unique constraint "portfolio_snapshots_one_per_account_day"',
      }),
    ).toBe(true);
  });

  test("every other Postgres error is still an error", () => {
    // Narrow on purpose. Swallowing a permissions failure or a missing table
    // would hide the snapshot series quietly failing to record at all, which is
    // worse than the duplicate this tolerates — nothing at all would show.
    expect(isUniqueViolation({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isUniqueViolation({ code: "42P01", message: "relation does not exist" })).toBe(false);
    expect(isUniqueViolation({ code: "23503", message: "foreign key violation" })).toBe(false);
    expect(isUniqueViolation({ message: "network error" })).toBe(false);
  });

  test("non-objects are never a unique violation", () => {
    for (const v of [null, undefined, "23505", 23505, true, new Error("boom")]) {
      expect(isUniqueViolation(v)).toBe(false);
    }
  });

  test("a numeric code is not a match", () => {
    // SQLSTATE codes are strings. A loose comparison would let a numeric 23505
    // from some other client through, and that is a different error entirely.
    expect(isUniqueViolation({ code: 23505 })).toBe(false);
  });

  test("an inherited `code` does not match", () => {
    // `\"code\" in error` walks the prototype chain, so an error class exposing
    // `code` on its prototype would match and its failure would be swallowed.
    // The failure mode of this guard is a real error going unreported, so it
    // fails towards throwing.
    class InheritedCode extends Error {}
    (InheritedCode.prototype as unknown as { code: string }).code = PG_UNIQUE_VIOLATION;
    const err = new InheritedCode("not actually a duplicate");
    expect("code" in err).toBe(true); // the looser check would have matched
    expect(isUniqueViolation(err)).toBe(false);
  });
});
