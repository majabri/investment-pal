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

// ---------------------------------------------------------------------------
// Recording a flow (PERF-001, write side)
// ---------------------------------------------------------------------------
//
// Until this existed the table was unreachable: one SELECT and no INSERT
// anywhere in the app, so `cash_flows` could only ever be empty and
// `flowCoverage` could only ever answer `unknown`. The arithmetic above was
// correct and could never run on a real figure.

import { isFutureLocalDate, isRealCalendarDate } from "./localDate";

/** Where a row came from. Mirrors the `source` arm of `cash_flows_bounds`. */
export type CashFlowSource = "imported" | "user_entry" | "derived";

/** A flow as the entry form holds it, before anything is stored. */
export type FlowDraft = {
  flowDate: string;
  kind: CashFlowKind;
  /** NULL while the box is empty — not zero, which the CHECK forbids anyway. */
  amount: number | null;
  treatment: CashFlowTreatment;
  symbol: string | null;
  note: string | null;
};

/** Why a draft cannot be stored, in the holder's terms. */
export type FlowRejection = {
  field: "flowDate" | "amount" | "symbol";
  message: string;
};

/**
 * Everything wrong with a draft. Empty means it may be stored.
 *
 * These mirror the `cash_flows_bounds` CHECK deliberately and are not a
 * substitute for it: the database is the guarantee, this is the readable
 * refusal. A sign typed the wrong way round would otherwise come back as a
 * Postgres constraint violation, which tells the holder nothing about which box
 * to fix — and the sign is the one mistake here that inverts a return silently.
 */
export function validateFlow(draft: FlowDraft): FlowRejection[] {
  const out: FlowRejection[] = [];

  if (!isRealCalendarDate(draft.flowDate)) {
    out.push({ field: "flowDate", message: "Enter the date the money moved, as YYYY-MM-DD." });
  } else if (isFutureLocalDate(draft.flowDate)) {
    // Stricter than the CHECK, on purpose. A future-dated flow is a plan, and
    // a plan inside the flow series shifts every return window that spans it.
    out.push({
      field: "flowDate",
      message: "That date is in the future. Record a flow after it has happened.",
    });
  }

  const a = draft.amount;
  if (a === null || !Number.isFinite(a)) {
    out.push({ field: "amount", message: "Enter the amount that moved." });
  } else if (a === 0) {
    out.push({ field: "amount", message: "Zero is not a flow. Leave it out rather than recording it." });
  } else if (draft.kind === "deposit" && a < 0) {
    out.push({
      field: "amount",
      message: "A deposit is money in, so it is positive. For money out, choose Withdrawal.",
    });
  } else if (draft.kind === "withdrawal" && a > 0) {
    out.push({
      field: "amount",
      message: "A withdrawal is money out, so it is negative. For money in, choose Deposit.",
    });
  }

  if (draft.symbol !== null && draft.symbol.trim() === "") {
    out.push({ field: "symbol", message: "Leave the symbol empty, or name the holding." });
  }

  return out;
}

/** Whether a draft may be stored at all. */
export function canRecordFlow(draft: FlowDraft): boolean {
  return validateFlow(draft).length === 0;
}

/**
 * The row written to `cash_flows`.
 *
 * Built here rather than at the call site for the same reason
 * `goalVersionInsert` is: what goes into a table the return arithmetic reads is
 * worth a unit test, and one home per payload keeps a column from being
 * spelled two ways.
 */
export function flowInsert(input: {
  userId: string | undefined;
  accountId: string;
  draft: FlowDraft;
  source?: CashFlowSource;
}): Record<string, unknown> {
  const { draft } = input;
  return {
    user_id: input.userId ?? null,
    account_id: input.accountId,
    flow_date: draft.flowDate,
    kind: draft.kind,
    amount: draft.amount,
    // Never defaulted from `kind` at write time. DEFAULT_TREATMENT suggests it
    // in the form; what the holder chose is what is stored, because a dividend
    // swept out of the account is external and only they know that.
    treatment: draft.treatment,
    symbol: draft.symbol === null || draft.symbol.trim() === "" ? null : draft.symbol.trim(),
    note: draft.note === null || draft.note.trim() === "" ? null : draft.note.trim(),
    source: input.source ?? "user_entry",
  };
}

/**
 * A blank draft for the entry form.
 *
 * `treatment` follows `DEFAULT_TREATMENT` for the starting kind, and the form
 * re-suggests on a kind change — a suggestion the holder can always override,
 * which is the whole reason the column exists separately from `kind`.
 */
export function emptyDraft(today: string, kind: CashFlowKind = "deposit"): FlowDraft {
  return {
    flowDate: today,
    kind,
    amount: null,
    treatment: DEFAULT_TREATMENT[kind],
    symbol: null,
    note: null,
  };
}

/**
 * What recording a flow does NOT do: promote coverage.
 *
 * `cash_flows_as_of` is a claim that somebody looked at the whole period, and
 * one row is not that claim. Entering a single deposit must leave coverage
 * `unknown`, because a partial history produces rows too and a return computed
 * over a partial history is wrong by exactly what is missing. Promotion is a
 * separate, explicit act: `useMarkFlowsReviewed`, which writes
 * `accounts.cash_flows_as_of`.
 */
export function coverageAfterRecording(asOf: string | null, rowCount: number): FlowCoverage {
  return flowCoverage(asOf, rowCount);
}
