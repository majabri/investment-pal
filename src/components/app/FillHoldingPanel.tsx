// Fills against holdings (ADR-APP-016, ORD-001 option a). Read-only: the
// product is a flag, and nothing here writes.
import { useFills } from "@/hooks/useAppData";
import { useFillHoldingReconciliation } from "@/hooks/useFillHoldingReconciliation";
import { exclusionsNote, reconciliationHeadline, symbolSentence } from "@/lib/fillHoldingReconciliation";
import type { Order } from "@/lib/orders";

export function FillHoldingPanel({ accountId, orders }: { accountId: string | null; orders: readonly Order[] }) {
  const fills = useFills(orders.map((o) => o.id));
  const view = useFillHoldingReconciliation(accountId, orders, fills.data);
  if (accountId === null) return null;

  return (
    <section aria-label="Fills against holdings" className="mb-4 rounded-xl border bg-card px-4 py-3 text-xs">
      <div className="mb-1 text-sm font-medium">Fills against the last import</div>
      {view.isLoading || fills.isLoading ? (
        <p className="text-muted-foreground">Reading the last import and its audit trail…</p>
      ) : view.result === null ? null : (
        <>
          <p className="text-muted-foreground">{reconciliationHeadline(view.result)}</p>
          {view.result.status === "compared" && view.result.lines.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {view.result.lines.map((l) => (
                <li key={l.symbol} className={l.verdict === "explained" ? "" : "font-medium"}>
                  {symbolSentence(l)}
                </li>
              ))}
            </ul>
          ) : null}
          {exclusionsNote(view.result) ? <p className="mt-2 text-muted-foreground">{exclusionsNote(view.result)}</p> : null}
          {fills.data && fills.data.unreadable > 0 ? (
            <p className="mt-1 text-muted-foreground">{fills.data.unreadable} fill rows could not be read and are not counted.</p>
          ) : null}
          {view.orphaned > 0 ? (
            <p className="mt-1 text-muted-foreground">{view.orphaned} fills belong to orders not in this account's list and are not counted.</p>
          ) : null}
          <p className="mt-2 text-muted-foreground">Holdings change only by import. This compares; it never applies.</p>
        </>
      )}
    </section>
  );
}
