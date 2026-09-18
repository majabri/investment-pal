// The reads behind the fills-against-holdings view (ADR-APP-016).
//
// Two account-scoped queries: the last two committed imports (this one and
// the one before, whose end opens the window) and the audit rows the import
// wrote on `holdings` inside that window. Fills and orders arrive from the
// caller, which already holds them for the orders panel. The comparison
// itself is `lib/fillHoldingReconciliation.ts`, pure.
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabaseClient";
import type { Fill } from "@/lib/fills";
import type { FillRead } from "@/lib/fillRows";
import type { Order } from "@/lib/orders";
import { reconcileFillsToHoldings } from "@/lib/fillHoldingReconciliation";
import type { FillHoldingReconciliation, FillWithOrder, HoldingAuditRow, ImportWindow } from "@/lib/fillHoldingReconciliation";

type BatchRow = { id: string; started_at: string; finished_at: string | null; outcome: string };

/** This account's latest committed import and the one before it, as a window. */
export function useImportWindow(accountId: string | null) {
  return useQuery({
    queryKey: ["import-window", accountId],
    enabled: accountId !== null,
    queryFn: async (): Promise<ImportWindow | null> => {
      const { data, error } = await supabase
        .from("import_batches")
        .select("id,started_at,finished_at,outcome")
        .eq("account_id", accountId!)
        .eq("outcome", "committed")
        .not("finished_at", "is", null)
        .order("finished_at", { ascending: false })
        .limit(2);
      if (error) throw error;
      const rows = (data ?? []) as BatchRow[];
      const latest = rows[0];
      if (!latest || latest.finished_at === null) return null;
      return {
        batchId: latest.id,
        startedAt: latest.started_at,
        finishedAt: latest.finished_at,
        priorFinishedAt: rows[1]?.finished_at ?? null,
      };
    },
  });
}

type AuditRow = {
  op: string;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
  changed_at: string;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** What the import did to this account's holdings, from the audit trail, inside the window. */
export function useHoldingAudit(accountId: string | null, window: ImportWindow | null | undefined) {
  return useQuery({
    queryKey: ["holding-audit", accountId, window?.batchId ?? null],
    enabled: accountId !== null && window != null,
    queryFn: async (): Promise<HoldingAuditRow[]> => {
      const w = window!;
      const { data, error } = await supabase
        .from("audit_log")
        .select("op,old_row,new_row,changed_at")
        .eq("table_name", "holdings")
        .gte("changed_at", w.startedAt)
        .lte("changed_at", w.finishedAt)
        .or(`new_row->>account_id.eq.${accountId},old_row->>account_id.eq.${accountId}`)
        .order("changed_at", { ascending: true });
      if (error) throw error;
      const out: HoldingAuditRow[] = [];
      for (const r of (data ?? []) as AuditRow[]) {
        const symbol = (r.new_row?.symbol ?? r.old_row?.symbol) as string | undefined;
        if (!symbol) continue;
        out.push({
          symbol,
          before: r.op === "INSERT" ? null : num(r.old_row?.quantity),
          after: r.op === "DELETE" ? null : num(r.new_row?.quantity),
          changedAt: r.changed_at,
        });
      }
      return out;
    },
  });
}

/** Fills joined to their order's side and status. Orders not found are counted, not guessed. */
export function joinFills(read: FillRead | undefined, orders: readonly Order[]): { fills: FillWithOrder[]; orphaned: number } {
  if (!read) return { fills: [], orphaned: 0 };
  const byId = new Map(orders.map((o) => [o.id, o]));
  const fills: FillWithOrder[] = [];
  let orphaned = 0;
  for (const [orderId, list] of read.byOrder) {
    const o = byId.get(orderId);
    if (!o) {
      orphaned += list.length;
      continue;
    }
    for (const f of list as Fill[]) fills.push({ symbol: o.symbol, side: o.side, orderStatus: o.status, quantity: f.quantity, filledAt: f.filled_at });
  }
  return { fills, orphaned };
}

export type FillHoldingView = {
  isLoading: boolean;
  result: FillHoldingReconciliation | null;
  /** Fills whose order was not in the list — counted, never guessed at. */
  orphaned: number;
};

export function useFillHoldingReconciliation(accountId: string | null, orders: readonly Order[], fills: FillRead | undefined): FillHoldingView {
  const window = useImportWindow(accountId);
  const audit = useHoldingAudit(accountId, window.data);
  if (accountId === null) return { isLoading: false, result: null, orphaned: 0 };
  if (window.isLoading || (window.data && audit.isLoading)) return { isLoading: true, result: null, orphaned: 0 };
  const joined = joinFills(fills, orders);
  const result = reconcileFillsToHoldings({
    window: window.data ?? null,
    audit: audit.isError ? null : window.data ? (audit.data ?? null) : null,
    fills: joined.fills,
  });
  return { isLoading: false, result, orphaned: joined.orphaned };
}
