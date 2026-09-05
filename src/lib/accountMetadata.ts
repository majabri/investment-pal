// What an account IS, as data rather than as a guess about its name (Phase 1b,
// rule 4).
//
// Behaviour used to be read off `accounts.name` by string-matching: a list of
// first names meant "kids", /529/ meant education, /crypto/i meant crypto,
// /IRA|ROTH|ROLLOVER/i meant retirement, and anything else was the holder's own
// primary account. Renaming an account silently changed its tax treatment and
// which screens and prompts it appeared in, and one household's names were
// compiled into the classifier, so it could not serve a second user without a
// source change (rule 37).
//
// These lists live here rather than in the Settings route so they are
// importable by tests. A value the database's CHECK constraint rejects fails on
// Save, in production, with a database error — so the agreement between this
// file and the migration is asserted by test, not by memory.

/**
 * The account-type vocabulary.
 *
 * This is `main`'s nine-value list, which the Settings editor already writes,
 * plus `529` and `crypto` — the two categories the old name-matcher recognised
 * that had no way to be recorded. The 2026-09-05 brief proposes a different,
 * coarser set; adopting it would have made every existing account fail the new
 * CHECK the next time someone pressed Save.
 */
export const ACCOUNT_TYPES = [
  "brokerage",
  "ira",
  "roth_ira",
  "401k",
  "hsa",
  "custodial",
  "trust",
  "529",
  "crypto",
  "cash",
  "other",
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

/**
 * How the account is taxed.
 *
 * A separate axis from the type on purpose: a Roth and a traditional IRA are
 * both retirement accounts and are taxed oppositely, so deriving one from the
 * other is the same inference-from-a-label this phase removes.
 */
export const TAX_TREATMENTS = ["taxable", "tax_deferred", "tax_free", "education"] as const;

export type TaxTreatment = (typeof TAX_TREATMENTS)[number];

/** Where `account_type` came from. Only the last two are answers from a person. */
export const ACCOUNT_TYPE_SOURCES = [
  /** The Phase 1b migration read it off the account name. */
  "inferred_from_name",
  /** Nobody chose it: it is the old `NOT NULL DEFAULT 'brokerage'`. */
  "legacy_default",
  "user_set",
  "imported",
] as const;

export type AccountTypeSource = (typeof ACCOUNT_TYPE_SOURCES)[number];

export const ACCOUNT_STATUSES = ["active", "closed", "archived"] as const;

/**
 * Whether the app should still be asking about this account's type.
 *
 * `inferred_from_name` and `legacy_default` are both the app's own guesses
 * wearing a stored value. Treating them as settled is how a wrong guess becomes
 * permanent — and `legacy_default` in particular means "a schema default said
 * taxable brokerage", which is a claim about tax treatment nobody made.
 */
export function accountTypeIsConfirmed(source: string | null | undefined): boolean {
  return source === "user_set" || source === "imported";
}

/** Structural minimum for asking whether an account's type is settled. */
export type ClassifiableAccount = {
  id: string;
  name: string;
  account_type: string | null;
  account_type_source: string | null;
};

/**
 * The accounts whose type nobody has answered for.
 *
 * Includes accounts with NO type at all and accounts carrying one of the app's
 * own guesses. Those two are the same problem from the user's side — the app
 * does not know what this account is — and both are fixed by the same action,
 * so a UI that surfaced only one would leave the other silently wrong.
 */
export function unconfirmedAccounts<T extends ClassifiableAccount>(accounts: readonly T[]): T[] {
  return accounts.filter((a) => !accountTypeIsConfirmed(a.account_type_source));
}
