// Recognising specific Postgres errors coming back through Supabase.
//
// Split out of `portfolioSummary` (Copilot, #120): that module is the pure
// arithmetic behind the summary surface, and a database error shape has no
// business in it. This is where the next such check goes too.
//
// Codes are SQLSTATE strings. The full list is in the Postgres manual under
// "Appendix A. PostgreSQL Error Codes"; only what the app actually acts on is
// named here, because a constant nothing reads is a claim about behaviour that
// does not exist.

/** unique_violation. A row already exists with that key. */
export const PG_UNIQUE_VIOLATION = "23505";

/**
 * True when this is a Postgres unique violation, and nothing else.
 *
 * Own-property check, not `"code" in error`: `in` walks the prototype chain, so
 * an error class exposing `code` on its prototype would match and its failure
 * would be swallowed. The failure mode of this guard is a real error going
 * unreported, so it fails towards throwing.
 *
 * The value is compared as a STRING. SQLSTATE codes are strings; a loose
 * comparison would let a numeric `23505` from some other client through, and
 * that is a different error entirely.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (!Object.prototype.hasOwnProperty.call(error, "code")) return false;
  return (error as { code: unknown }).code === PG_UNIQUE_VIOLATION;
}
