// Aggregating balances across accounts.
//
// Pure and free of the Supabase client on purpose: this is the rule that
// decides whether a household total may be stated at all, and it has to be
// testable without a database. (It also has to be importable from the test
// project, whose tsconfig types are Bun's rather than the DOM's — a module that
// reaches the Supabase client drags `fetch` typings in with it.)

/** The four money fields an account carries. NULL means NOT KNOWN. */
export type BalanceFields = {
  cash: number | null;
  margin_used: number | null;
  margin_limit: number | null;
  buying_power: number | null;
};

/**
 * Sum one field across accounts, or NULL when any contributing account does not
 * know its value.
 *
 * This used to coerce with `|| 0`, so a blend of three accounts where one has
 * never been populated reported the other two's total as the household's — a
 * number wrong by exactly the amount nobody supplied, in the same typeface as
 * one that is right.
 *
 * All-or-nothing on purpose. "Sum of the accounts that happen to have data" is
 * not a household total, and there is no way to render it that does not read as
 * one.
 *
 * An empty list sums to 0, which is not the same case: nothing to add is a
 * known fact, where a missing figure is not.
 */
export function sumField<T extends Partial<BalanceFields>>(
  accounts: readonly T[],
  key: keyof BalanceFields,
): number | null {
  let total = 0;
  for (const a of accounts) {
    const v = a[key as keyof T] as number | null | undefined;
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
    total += Number(v);
  }
  return total;
}
