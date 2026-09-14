// Reading `fills` rows into the domain type, without the cast that lies.
//
// The same boundary `trancheRows.ts` guards, for the same reason: Postgres
// constrains `source` with `fills_bounds`, PostgREST reports the column's type,
// and the generated `Row<"fills">` therefore says `string` where `Fill` says
// `"imported" | "user_entry" | "derived"`. A cast would hand any string the
// narrow type, and rule 18 — no AI value — would be enforced at the database
// and silently un-enforced at the first screen.
//
// A row that cannot be read is COUNTED. Fills are the evidence behind an
// order's filled quantity; a list quietly one fill short reconciles as `under`
// against the order and looks exactly like an order that is still filling.

import type { Row } from "@/lib/dbRows";
import type { Fill, FillSource } from "@/lib/fills";

/** The sources `fills_bounds` permits. Kept beside the parser it guards. */
export const FILL_SOURCES: readonly FillSource[] = ["imported", "user_entry", "derived"] as const;

export function isFillSource(value: string): value is FillSource {
  return (FILL_SOURCES as readonly string[]).includes(value);
}

/** One row as a `Fill`, or null when its source cannot be classified. */
export function fillFromRow(row: Row<"fills">): Fill | null {
  if (!isFillSource(row.source)) return null;
  return {
    id: row.id,
    order_id: row.order_id,
    filled_at: row.filled_at,
    quantity: row.quantity,
    price: row.price,
    fees: row.fees,
    source: row.source,
    broker_ref: row.broker_ref,
  };
}

/** A fetch of `fills`, grouped by the order each belongs to. */
export type FillRead = {
  /** Fills per order id, each list oldest first — the order two partials happened in. */
  byOrder: ReadonlyMap<string, Fill[]>;
  /** Rows that could not be read. Non-zero means some order below is short. */
  unreadable: number;
  /** Readable fills across every order. */
  total: number;
};

export function readFills(rows: readonly Row<"fills">[]): FillRead {
  const byOrder = new Map<string, Fill[]>();
  let unreadable = 0;
  let total = 0;
  for (const row of rows) {
    const f = fillFromRow(row);
    if (f === null) {
      unreadable += 1;
      continue;
    }
    total += 1;
    const list = byOrder.get(f.order_id);
    if (list) list.push(f);
    else byOrder.set(f.order_id, [f]);
  }
  for (const list of byOrder.values()) {
    list.sort((a, b) => (a.filled_at < b.filled_at ? -1 : a.filled_at > b.filled_at ? 1 : 0));
  }
  return { byOrder, unreadable, total };
}

/** The fills recorded against one order. Absent is empty, which is `not_recorded` downstream. */
export function fillsOf(read: FillRead, orderId: string): Fill[] {
  return read.byOrder.get(orderId) ?? [];
}

/** The sentence a panel shows when fills could not be read, or null. */
export function unreadableFillsNote(read: FillRead): string | null {
  if (read.unreadable === 0) return null;
  const n = read.unreadable;
  return `${n} fill${n === 1 ? "" : "s"} could not be read and ${n === 1 ? "is" : "are"} not counted below. Some orders may show fewer fills than were recorded.`;
}
