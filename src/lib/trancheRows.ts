// Reading `tranches` rows into the domain type, without the cast that lies.
//
// The generated types widen `kind` to `string`: Postgres constrains it with a
// CHECK, but PostgREST reports the column's type, not its constraint. Casting
// the row straight to `Tranche` — the pattern `useLots` uses — would give a row
// carrying any string a compile-time type saying it is `"core" | "tactical"`,
// and the first place that reads `byKind` would silently produce a category
// nobody defined.
//
// So the boundary validates. A row whose `kind` is unrecognised is not dropped
// quietly and not coerced to a default: it is COUNTED, and the caller says so.
// Unknown is not empty, and a position the app cannot classify is not a
// position the app should render as if it had.

import type { Row } from "@/lib/dbRows";
import type { Tranche, TrancheKind } from "@/lib/tranches";

/** The kinds the schema's CHECK permits. Kept beside the parser it guards. */
export const TRANCHE_KINDS: readonly TrancheKind[] = ["core", "tactical"] as const;

export function isTrancheKind(value: string): value is TrancheKind {
  return (TRANCHE_KINDS as readonly string[]).includes(value);
}

/**
 * One row as a `Tranche`, or null when it cannot be read as one.
 *
 * Null means "this row exists and I cannot classify it" — a different claim
 * from "there is no such row", which is why the caller gets a count rather
 * than a shorter list.
 */
export function trancheFromRow(row: Row<"tranches">): Tranche | null {
  if (!isTrancheKind(row.kind)) return null;
  return {
    id: row.id,
    account_id: row.account_id,
    symbol: row.symbol,
    security_id: row.security_id,
    kind: row.kind,
    decision_id: row.decision_id,
    opened_at: row.opened_at,
    closed_at: row.closed_at,
    opened_quantity: row.opened_quantity,
    target: row.target,
    invalidation: row.invalidation,
  };
}

/** What a fetch of `tranches` yields: the readable rows, and how many were not. */
export type TrancheRead = {
  tranches: Tranche[];
  /**
   * Rows present in the table that could not be read. Non-zero means the screen
   * is showing LESS than the account holds, and it has to say so — a silently
   * short list is indistinguishable from a correct one.
   */
  unreadable: number;
};

export function readTranches(rows: readonly Row<"tranches">[]): TrancheRead {
  const tranches: Tranche[] = [];
  let unreadable = 0;
  for (const row of rows) {
    const t = trancheFromRow(row);
    if (t === null) unreadable += 1;
    else tranches.push(t);
  }
  return { tranches, unreadable };
}

/**
 * The sentence a screen shows when rows could not be read, or null.
 *
 * Null when everything read cleanly — a caveat on every screen is a caveat
 * nobody reads, which is the same reasoning as `aggregationNote`.
 */
export function unreadableNote(read: TrancheRead): string | null {
  if (read.unreadable === 0) return null;
  const n = read.unreadable;
  return `${n} tranche${n === 1 ? "" : "s"} could not be read and ${n === 1 ? "is" : "are"} not counted below. The totals here are lower than the account holds.`;
}
