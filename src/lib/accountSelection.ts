// Pure account-selection logic (PR-UI-2). Deliberately free of React and of the
// Supabase client so it is unit-testable on its own — the context below is just
// the React wiring around these two functions.
//
// The rule both functions encode: never substitute one account's rows for
// another's. The code this replaces fell back to accountless holdings on a
// lookup miss, rendering a plausible but wrong portfolio with no error.
import { accountCategory } from "./data/accountGroups";

/** Structural minimum — avoids depending on the full row type. */
export type AccountLike = { id: string; name: string; account_type: string | null };
export type HoldingLike = { account_id: string | null };

/**
 * Default selection when the user has never chosen: the first account in the
 * primary (self) category, else the first account. Category comes from
 * `accountCategory()` — deliberately the one existing categorisation scheme,
 * not a second one, and as of Phase 1b it reads the account's TYPE rather than
 * matching its name.
 *
 * The `else the first account` fallback is what makes this safe while accounts
 * are still being classified: an unclassified household selects something
 * rather than nothing, and the Settings banner says why it could not do
 * better.
 */
export function defaultAccountId(accounts: AccountLike[]): string | null {
  if (accounts.length === 0) return null;
  const primary = accounts.find((a) => accountCategory(a) === "Primary");
  return (primary ?? accounts[0]).id;
}

/**
 * Holdings for the selected account.
 *
 * When nothing is resolved this returns `[]` — never all holdings, and never
 * the accountless rows. Callers must handle the empty case explicitly; wrong
 * numbers are worse than no numbers.
 *
 * `includeUnassigned` keeps accountless manual adds visible on screens that
 * already counted them once an account IS resolved; it never applies to the
 * unresolved case.
 */
export function selectAccountHoldings<T extends HoldingLike>(
  holdings: T[],
  accountId: string | null,
  { includeUnassigned = false }: { includeUnassigned?: boolean } = {},
): T[] {
  if (!accountId) return [];
  return holdings.filter(
    (h) => h.account_id === accountId || (includeUnassigned && h.account_id == null),
  );
}
