// What crossed the portfolio's boundary, and whether we have been told (PERF-001).
//
// The table is `cash_flows` (migration 20260910150000). This module is the
// meaning of its rows: which of them are removed from return, and — more
// important — whether the answer is known at all.
//
// The trap this exists to avoid: an account with no flow rows looks exactly
// like an account with no flows. Computing a time-weighted return under the
// second reading when the first is true reproduces the original defect with a
// better name on it, so "no rows" is only ever taken at face value when
// `accounts.cash_flows_as_of` says somebody has actually looked.

/** What happened. Mirrors the `cash_flows_bounds` CHECK. */
export type CashFlowKind = "deposit" | "withdrawal" | "dividend" | "fee" | "interest";

/**
 * How the return arithmetic must handle it.
 *
 * `external` — crossed the boundary; removed from return.
 * `internal` — happened inside the portfolio and IS return: a dividend left in
 * the account, a fee paid from it.
 */
export type CashFlowTreatment = "external" | "internal";

/** A row, in the shape the return arithmetic needs. */
export type CashFlowRow = {
  flow_date: string;
  amount: number;
  kind: CashFlowKind;
  treatment: CashFlowTreatment;
};

/**
 * The treatment a kind takes when nobody has said otherwise.
 *
 * A SUGGESTION for the entry form, never applied to a stored row. The stored
 * `treatment` column is authoritative precisely because these defaults are
 * wrong for real cases: a dividend swept to a bank account is external, and a
 * management fee billed from outside the account is a contribution.
 */
export const DEFAULT_TREATMENT: Record<CashFlowKind, CashFlowTreatment> = {
  deposit: "external",
  withdrawal: "external",
  // Left in the account, a dividend is return. Subtracting it would understate
  // performance by exactly the dividend, every quarter, forever.
  dividend: "internal",
  // A cost of running the strategy, borne by the portfolio.
  fee: "internal",
  interest: "internal",
};

/** How each kind reads in the UI, so a stored row can be explained. */
export const KIND_LABEL: Record<CashFlowKind, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  dividend: "Dividend",
  fee: "Fee",
  interest: "Interest",
};

/**
 * Whether this account's flow history is known.
 *
 * `unknown` is the state every existing account is in and the only safe
 * default: it is what stops a return being computed from an absence.
 * `none` is a positive fact — somebody looked, and there were no flows — and
 * a real return CAN be computed under it.
 */
export type FlowCoverage = "unknown" | "none" | "known";

/**
 * Coverage from the account's own record.
 *
 * `asOf` is `accounts.cash_flows_as_of`: NULL means nobody has ever said. It is
 * deliberately the ONLY thing that can promote coverage out of `unknown` —
 * rows alone cannot, because a partial import produces rows too.
 */
export function flowCoverage(asOf: string | null | undefined, rowCount: number): FlowCoverage {
  if (asOf === null || asOf === undefined || asOf === "") return "unknown";
  return rowCount > 0 ? "known" : "none";
}

/** The external flows only, dated, as the return arithmetic wants them. */
export function externalFlows(rows: readonly CashFlowRow[]): { date: string; amount: number }[] {
  return rows
    .filter((r) => r.treatment === "external" && Number.isFinite(r.amount))
    .map((r) => ({ date: r.flow_date, amount: r.amount }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Net external flow across a half-open window `(from, to]`, in dollars. */
export function netExternalFlow(
  rows: readonly CashFlowRow[],
  fromExclusive: string,
  toInclusive: string,
): number {
  let sum = 0;
  for (const f of externalFlows(rows)) {
    if (f.date > fromExclusive && f.date <= toInclusive) sum += f.amount;
  }
  return sum;
}
