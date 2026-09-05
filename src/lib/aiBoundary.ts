// AI is downstream (Phase 5, rule 18).
//
// "AI may analyse, flag inconsistencies, and recommend. It may NEVER be the
// source of account equity, cash, margin debt, position quantity, cost basis,
// buying power, open orders, fills, balances, or transaction history."
//
// The app is compliant today by accident rather than by construction: the one
// place an AI response becomes a database row — the Action Sheet extractor —
// happens to write only recommendation columns. Nothing prevents the next
// person adding `cash: parsedFromResponse` to that payload, and nothing would
// notice if they did. A model that has been told the cash balance is NOT KNOWN
// will helpfully estimate one, and an estimate written into `accounts.cash` is
// indistinguishable from an imported figure the moment it lands.
//
// So the rule becomes a boundary with a runtime check and a source guard:
//
//   * `assertAiWritable` refuses the write. It is a throw rather than a filter
//     on purpose — silently dropping the field would leave the caller
//     believing it was saved.
//   * `aiWritableTables` is a closed list. A new table for AI output is a
//     deliberate edit here, reviewed as such.
//
// Pure, so the boundary is testable without React or the Supabase client.

/**
 * Column names that carry FINANCIAL TRUTH — what is actually in the account.
 *
 * Every one of these must come from a broker import, a user's own entry, or
 * arithmetic over those. None may come from a model, however confident it is
 * and however plausible the number looks.
 *
 * Matched by name across tables rather than per table, deliberately: the point
 * is not that `accounts.cash` specifically is protected, it is that a column
 * called `cash` anywhere is a claim about money.
 */
export const FINANCIAL_TRUTH_FIELDS = [
  // Balances and equity
  "cash",
  "equity",
  "equity_pct",
  "balance",
  "total_account_value",
  "gross_value",
  "net_value",
  "settled_cash",
  "withdrawable_cash",
  // Margin
  "margin_used",
  "margin_debit",
  "margin_limit",
  "margin_debt",
  "buying_power",
  "available_capital",
  // Positions
  "quantity",
  "shares",
  "cost_basis",
  "avg_cost",
  "current_price",
  "positions_value",
  // Orders, fills, history
  "open_orders",
  "order_quantity",
  "filled_quantity",
  "average_fill_price",
  "transaction_amount",
] as const;
export type FinancialTruthField = (typeof FINANCIAL_TRUTH_FIELDS)[number];

/**
 * The only tables an AI-derived payload may be written to.
 *
 * Both hold what a model SAID, never what the account HOLDS: `decisions` is a
 * log of recommendations with their outcomes, `journal_entries` is prose.
 * Neither is read by the accounting engine.
 */
export const AI_WRITABLE_TABLES = ["decisions", "journal_entries"] as const;
export type AiWritableTable = (typeof AI_WRITABLE_TABLES)[number];

const FORBIDDEN: ReadonlySet<string> = new Set<string>(FINANCIAL_TRUTH_FIELDS);

export class AiBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiBoundaryError";
  }
}

/**
 * Throw unless this row may be written from AI output.
 *
 * A throw, not a filter. Dropping the offending field silently would leave the
 * caller believing it had been saved, and the user believing a figure on
 * screen came from their broker.
 *
 * `price_at_rec` is the case worth understanding: `decisions` carries it, and
 * it IS a price. It is permitted because it is not AI-derived — the extractor
 * reads it from the live quote map, not from the response text. The boundary
 * cannot see where a value came from, only what it is called, so the column is
 * named in `PROVENANCE_EXEMPT` below with the argument attached rather than
 * being quietly absent from the forbidden list.
 */
export function assertAiWritable(table: string, row: Record<string, unknown>): void {
  if (!(AI_WRITABLE_TABLES as readonly string[]).includes(table)) {
    throw new AiBoundaryError(
      `AI output may not be written to "${table}". Rule 18: a model may recommend, ` +
        `it may never be the source of a financial figure. Allowed: ${AI_WRITABLE_TABLES.join(", ")}.`,
    );
  }
  const offending = Object.keys(row).filter((k) => FORBIDDEN.has(k));
  if (offending.length > 0) {
    throw new AiBoundaryError(
      `AI output may not write ${offending.join(", ")} to "${table}". Rule 18: these are ` +
        `financial truth and must come from an import, a person, or arithmetic over those.`,
    );
  }
}

/**
 * Columns that look financial and are allowed, each with the reason.
 *
 * Kept as data so a test can assert every entry still exists and still has an
 * argument — an exemption whose reason has gone stale is a hole that outlives
 * it, which is the lesson from the personal-data allowlist.
 */
export const PROVENANCE_EXEMPT: { column: string; table: AiWritableTable; why: string }[] = [
  {
    column: "price_at_rec",
    table: "decisions",
    why: "read from the live quote map at extraction time, not parsed from the model's text — it anchors the price for later outcome grading",
  },
  {
    column: "outcome_pl",
    table: "decisions",
    why: "computed when a decision is graded, from prices the app fetched; never written by the extractor",
  },
];
