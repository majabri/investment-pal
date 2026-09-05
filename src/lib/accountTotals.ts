// Account totals, scoped and reconcilable.
//
// The bug this replaces: `useHoldings()` selected every row with no account
// filter and `useAccount()` summed cash, margin and buying power across every
// account — TOD blended with the IRA, the kids' accounts, the 529s and crypto
// into one number. `AccountContext` existed and the switcher rendered, but the
// data layer never read from it.
//
// Verified against a Fidelity balances page, using the synthetic block in
// src/lib/__tests__/balanceImport.test.ts — the real capture this was derived
// from was removed in the 2026-09-05 P0 remediation:
//
//   cash market value      $2,500.00
//   margin market value  $145,950.00
//   net debit            −$20,000.00
//   total account value  $128,450.00
//
// Pure, so the arithmetic is testable against that statement without a database.

/** A holding, in the shape the totals need. */
export type PositionLike = {
  quantity: number;
  cost_basis: number;
  current_price: number;
};

/** The cash/margin side of an account. */
export type BalanceLike = {
  cash: number | null | undefined;
  margin_used: number | null | undefined;
};

export type AccountTotals = {
  /** Sum of quantity × current price. Fidelity's "margin market value". */
  positionsValue: number;
  /** Cash market value. */
  cash: number;
  /** Margin debit, as a positive number. */
  marginDebit: number;
  /** cash + positions. Gross, before the debit — NOT the account value. */
  grossValue: number;
  /** cash + positions − debit. Fidelity's "Total account value". */
  totalAccountValue: number;
  /** Sum of quantity × cost basis, over the same positions. */
  costBasis: number;
  /** positionsValue − costBasis, over the same positions. */
  unrealizedPL: number;
  /** Fraction in [0,1], or null when there is no gross to divide by. */
  unrealizedPLPct: number | null;
  /** Equity as a fraction of gross, or null when gross is zero. */
  equityPct: number | null;
  positionCount: number;
};

const num = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/**
 * Totals for one scope's positions and balances.
 *
 * `priceOf` lets a caller substitute a live quote for the stored
 * `current_price` without this module knowing anything about quotes.
 */
export function accountTotals<T extends PositionLike>(
  positions: readonly T[],
  balance: BalanceLike | null | undefined,
  priceOf: (p: T) => number = (p) => num(p.current_price),
): AccountTotals {
  let positionsValue = 0;
  let costBasis = 0;
  for (const p of positions) {
    const qty = num(p.quantity);
    positionsValue += qty * num(priceOf(p));
    costBasis += qty * num(p.cost_basis);
  }

  const cash = num(balance?.cash);
  // Stored as a positive magnitude; Fidelity prints it as a negative debit.
  const marginDebit = num(balance?.margin_used);

  const grossValue = cash + positionsValue;
  const totalAccountValue = grossValue - marginDebit;
  const unrealizedPL = positionsValue - costBasis;

  return {
    positionsValue,
    cash,
    marginDebit,
    grossValue,
    totalAccountValue,
    costBasis,
    unrealizedPL,
    unrealizedPLPct: costBasis > 0 ? unrealizedPL / costBasis : null,
    equityPct: grossValue > 0 ? totalAccountValue / grossValue : null,
    positionCount: positions.length,
  };
}

/**
 * How a figure is scoped, so every number on screen can say what it covers.
 *
 * There is deliberately no "unscoped" variant. The bug was a silent default
 * that meant "everything"; making the absence of a scope unrepresentable is
 * most of the fix.
 */
export type AccountScope =
  | { kind: "account"; accountId: string; accountName: string }
  | { kind: "all"; accountCount: number }
  | { kind: "none" };

/** Label for a figure's scope. Never empty — an unlabelled number is the defect. */
export function scopeLabel(scope: AccountScope): string {
  switch (scope.kind) {
    case "account":
      return scope.accountName;
    case "all":
      return `All ${scope.accountCount} accounts`;
    case "none":
      return "No account selected";
  }
}

/** Structural minimum for scoping a holding — avoids importing the row type. */
export type ScopedRow = { account_id: string | null };

/**
 * The rows a scope covers.
 *
 * `{ kind: "none" }` returns nothing. That is the whole point: the previous
 * behaviour was an unfiltered select, so a screen that could not resolve an
 * account got every account instead of none, and the totals silently became
 * the household's.
 *
 * `includeUnassigned` keeps accountless manual adds visible on screens that
 * already counted them — but only once an account IS resolved, never as a
 * stand-in for one.
 */
export function scopedRows<T extends ScopedRow>(
  rows: readonly T[],
  scope: AccountScope,
  { includeUnassigned = false }: { includeUnassigned?: boolean } = {},
): T[] {
  if (scope.kind === "none") return [];
  if (scope.kind === "all") return [...rows];
  return rows.filter(
    (r) => r.account_id === scope.accountId || (includeUnassigned && r.account_id == null),
  );
}

/** True when there is no scope to compute against, so the UI must say so. */
export function scopeIsEmpty(scope: AccountScope): boolean {
  return scope.kind === "none" || (scope.kind === "all" && scope.accountCount === 0);
}
