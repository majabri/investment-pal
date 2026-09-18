// Fills against holdings: the reconciliation view (ADR-APP-016; ORD-001 option
// (a); §26.2 test 8; ACC-4).
//
// Recording a fill changes nothing about a holding — the Fidelity import is
// the holding's source of truth (DATA-004). This module is the third leg of
// the ledger: `reconcileFills` compares fills with the ORDER's claim; this
// compares them with what the next IMPORT did to the HOLDING.
//
// The comparison is per symbol, per import:
//
//   expected  = Σ signed fill quantities recorded between the previous import
//               and this one (buy +, sell −), on orders that were not
//               cancelled, untriggered, superseded, rejected or expired
//   observed  = the holding's quantity after the import − before it, read
//               from the audit trail the import wrote (audit_log, #233)
//
// and the product is a FLAG, never a write: a fill the import did not
// reflect, a change no fill explains, or the two disagreeing. Nothing here
// touches a holding, a fill or an order.
//
// What it cannot know, it says: no committed import for the account, no
// audit rows for the import (the trail began 2026-09-17), a fill whose
// order has an unknown side.

/** One committed import, with the previous one's end as the window's start. */
export type ImportWindow = {
  batchId: string;
  startedAt: string;
  /** NULL only for a batch still staged; such a batch is never compared. */
  finishedAt: string;
  /** The previous committed import's end. NULL = this was the first. */
  priorFinishedAt: string | null;
};

/** One audit row on `holdings` inside the import window. */
export type HoldingAuditRow = {
  symbol: string;
  /** NULL on an INSERT: the position did not exist before. */
  before: number | null;
  /** NULL on a DELETE: the position no longer exists. */
  after: number | null;
  changedAt: string;
};

/** A fill joined to its order's side and status. */
export type FillWithOrder = {
  symbol: string;
  side: string;
  orderStatus: string;
  quantity: number;
  filledAt: string;
};

/** Order states whose fills never reach a holding (§12.1; §26.2 test 8). */
export const NON_HOLDING_STATUSES: readonly string[] = ["cancelled", "untriggered", "superseded", "rejected", "expired"];

export const QUANTITY_EPSILON = 1e-6;

/** +quantity for a buy, −quantity for a sale, NULL for a side the vocabulary does not know. */
export function signedQuantity(side: string, quantity: number): number | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  switch (side) {
    case "buy":
    case "buy_to_cover":
      return quantity;
    case "sell":
    case "sell_short":
      return -quantity;
    default:
      return null;
  }
}

/** Whether an instant lies in (priorFinishedAt, finishedAt]. */
export function inWindow(iso: string, w: ImportWindow): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const end = new Date(w.finishedAt).getTime();
  if (t > end) return false;
  if (w.priorFinishedAt === null) return true;
  return t > new Date(w.priorFinishedAt).getTime();
}

export type SymbolVerdict =
  /** Fills and the import agree. */
  | "explained"
  /** Fills were recorded; the import moved the holding by a different amount, or not at all. */
  | "fills_not_reflected"
  /** The holding moved; no fill in the window explains it. */
  | "change_unexplained"
  /** A fill's order side is not in the vocabulary, so the expectation cannot be summed. */
  | "side_unknown";

export type SymbolLine = {
  symbol: string;
  /** Σ signed fills, or NULL when a side was unknown. */
  expected: number | null;
  /** after − before across the import. */
  observed: number;
  fillCount: number;
  verdict: SymbolVerdict;
};

export type FillHoldingReconciliation =
  | { status: "no_import" }
  | { status: "no_audit"; window: ImportWindow }
  | {
      status: "compared";
      window: ImportWindow;
      lines: SymbolLine[];
      /** Fills on orders in a non-holding state: excluded from every expectation, counted here. */
      excludedFills: number;
      /** Fills outside the window: not this import's to explain. */
      outsideWindow: number;
    };

/** Per symbol, the holding's movement across the import: earliest `before` to latest `after`. */
export function holdingDeltas(rows: readonly HoldingAuditRow[]): Map<string, number> {
  const bySymbol = new Map<string, HoldingAuditRow[]>();
  for (const r of rows) {
    const arr = bySymbol.get(r.symbol) ?? [];
    arr.push(r);
    bySymbol.set(r.symbol, arr);
  }
  const out = new Map<string, number>();
  for (const [symbol, arr] of bySymbol) {
    const sorted = [...arr].sort((a, b) => a.changedAt.localeCompare(b.changedAt));
    const before = sorted[0]!.before ?? 0;
    const after = sorted[sorted.length - 1]!.after ?? 0;
    out.set(symbol, after - before);
  }
  return out;
}

/**
 * The comparison. `audit` NULL means the rows could not be read (not that
 * there were none): an import that changed nothing produces zero rows, and
 * that is a valid, comparable import.
 */
export function reconcileFillsToHoldings(input: {
  window: ImportWindow | null;
  audit: readonly HoldingAuditRow[] | null;
  fills: readonly FillWithOrder[];
}): FillHoldingReconciliation {
  if (input.window === null) return { status: "no_import" };
  if (input.audit === null) return { status: "no_audit", window: input.window };
  const w = input.window;

  let excludedFills = 0;
  let outsideWindow = 0;
  const expected = new Map<string, { sum: number; count: number; unknownSide: boolean }>();
  for (const f of input.fills) {
    if (!inWindow(f.filledAt, w)) {
      outsideWindow++;
      continue;
    }
    if (NON_HOLDING_STATUSES.includes(f.orderStatus)) {
      excludedFills++;
      continue;
    }
    const e = expected.get(f.symbol) ?? { sum: 0, count: 0, unknownSide: false };
    const q = signedQuantity(f.side, f.quantity);
    if (q === null) e.unknownSide = true;
    else e.sum += q;
    e.count++;
    expected.set(f.symbol, e);
  }

  const observed = holdingDeltas(input.audit);
  const symbols = [...new Set([...expected.keys(), ...observed.keys()])].sort();
  const lines: SymbolLine[] = symbols.map((symbol) => {
    const e = expected.get(symbol);
    const o = observed.get(symbol) ?? 0;
    if (e === undefined) return { symbol, expected: 0, observed: o, fillCount: 0, verdict: "change_unexplained" };
    if (e.unknownSide) return { symbol, expected: null, observed: o, fillCount: e.count, verdict: "side_unknown" };
    const verdict: SymbolVerdict = Math.abs(e.sum - o) <= QUANTITY_EPSILON ? "explained" : "fills_not_reflected";
    return { symbol, expected: e.sum, observed: o, fillCount: e.count, verdict };
  });
  // Symbols the import did not change and no fill touched do not appear:
  // "nothing happened" is not a line.
  return { status: "compared", window: w, lines, excludedFills, outsideWindow };
}

const fmtQty = (n: number) => {
  const s = Math.abs(n) < 1e-9 ? "0" : Number(n.toFixed(6)).toString();
  return n > 0 ? `+${s}` : s;
};

/** One line per symbol, in the holder's terms. */
export function symbolSentence(l: SymbolLine): string {
  switch (l.verdict) {
    case "explained":
      return `${l.symbol}: ${l.fillCount} ${l.fillCount === 1 ? "fill" : "fills"} (${fmtQty(l.expected ?? 0)}) match the import's change (${fmtQty(l.observed)}).`;
    case "fills_not_reflected":
      return `${l.symbol}: ${l.fillCount} ${l.fillCount === 1 ? "fill" : "fills"} sum to ${fmtQty(l.expected ?? 0)} but the import changed the holding by ${fmtQty(l.observed)}. Not applied — check the fills or wait for the next export.`;
    case "change_unexplained":
      return `${l.symbol}: the import changed the holding by ${fmtQty(l.observed)} and no recorded fill explains it.`;
    case "side_unknown":
      return `${l.symbol}: a fill's order has a side the app does not know, so the fills cannot be summed against the import's change (${fmtQty(l.observed)}).`;
  }
}

/** The headline above the lines. Says what was compared, or why nothing was. */
export function reconciliationHeadline(r: FillHoldingReconciliation): string {
  switch (r.status) {
    case "no_import":
      return "No committed import for this account yet, so recorded fills have nothing to be compared against.";
    case "no_audit":
      return `The import of ${r.window.finishedAt.slice(0, 10)} left no readable audit trail, so its effect on holdings cannot be compared with the fills.`;
    case "compared": {
      const flagged = r.lines.filter((l) => l.verdict !== "explained").length;
      const since = r.window.priorFinishedAt ? `since the import of ${r.window.priorFinishedAt.slice(0, 10)}` : "before the first import";
      const head = `Fills recorded ${since}, against the import of ${r.window.finishedAt.slice(0, 10)}: `;
      if (r.lines.length === 0) return head + "no fills and no holding changes to compare.";
      return head + (flagged === 0 ? `all ${r.lines.length} ${r.lines.length === 1 ? "symbol agrees" : "symbols agree"}.` : `${flagged} of ${r.lines.length} ${r.lines.length === 1 ? "symbol" : "symbols"} flagged. Nothing was applied.`);
    }
  }
}

/** The footnote on what was left out, when anything was. */
export function exclusionsNote(r: FillHoldingReconciliation): string | null {
  if (r.status !== "compared") return null;
  const parts: string[] = [];
  if (r.excludedFills > 0) parts.push(`${r.excludedFills} ${r.excludedFills === 1 ? "fill" : "fills"} on cancelled, untriggered, superseded, rejected or expired orders — never counted toward a holding`);
  if (r.outsideWindow > 0) parts.push(`${r.outsideWindow} ${r.outsideWindow === 1 ? "fill" : "fills"} outside this import's window`);
  return parts.length ? `Left out: ${parts.join("; ")}.` : null;
}
