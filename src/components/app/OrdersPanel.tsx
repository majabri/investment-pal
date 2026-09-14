// The first screen to read `orders` and `fills` (§12.3, rule 19).
//
// `orders.ts` shipped in Phase 6 with `remainingQuantity`, `committedCash` and
// `totalCommittedCash`; `fills.ts` shipped in #212 with the reconciliation and
// the volume-weighted average. Neither had a caller: the only thing that read
// `orders` at all was the readiness gate, and it read a timestamp, not rows.
// This is the read side. Nothing here writes.
//
// Every figure shown is one those libraries already compute. The panel decides
// how it is said, and says the uncomfortable cases plainly: an order whose
// state could not be mapped is "Status unknown" and counts as working; a
// committed-cash total that cannot be priced is "cannot be stated", never the
// sum of the ones that could; fills that exceed the roll-up are shown as
// exceeding it, not clamped.
import { Fragment, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Account } from "@/hooks/useAppData";
import { useFills } from "@/hooks/useAppData";
import { fillsOf, readFills, unreadableFillsNote } from "@/lib/fillRows";
import { fmtPrice, fmtUSD } from "@/lib/finance";
import type { Order } from "@/lib/orders";
import { openOrdersKnown } from "@/lib/orders";
import {
  averageAgreement,
  committedCash,
  committedSummary,
  fillSentence,
  fillSummary,
  isCommitted,
  ordersCoverageSentence,
  remainingQuantity,
  sideLabel,
  sortOrders,
  statusLabel,
} from "@/lib/ordersView";

/** Stable empty read for the no-orders case, so the render path is one path. */
const NO_FILLS = readFills([]);

const fmtQty = (q: number | null): string =>
  q === null ? "—" : q.toLocaleString("en-US", { maximumFractionDigits: 4 });

const fmtWhen = (iso: string | null): string =>
  iso === null ? "—" : new Date(iso).toLocaleDateString("en-US");

export function OrdersPanel({
  account,
  orders,
}: {
  /** NULL when no single account is in scope — orders are account-scoped. */
  account: Account | null;
  orders: Order[];
}) {
  const [showClosed, setShowClosed] = useState(false);
  const fills = useFills(orders.map((o) => o.id));
  const read = fills.data ?? NO_FILLS;

  if (account === null) {
    return (
      <div className="rounded-2xl border bg-card p-5">
        <div className="mb-1 text-sm font-medium">Orders</div>
        <p className="text-sm text-muted-foreground">
          Select a single account to see its orders. An order belongs to one account, not to
          the household.
        </p>
      </div>
    );
  }

  const known = openOrdersKnown(account);
  const sorted = sortOrders(orders);
  const working = sorted.filter((o) => isCommitted(o.status));
  const closed = sorted.filter((o) => !isCommitted(o.status));
  const shown = showClosed ? sorted : working;
  const committed = committedSummary(orders);
  const fillsShort = unreadableFillsNote(read);

  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">Orders</span>
        <span className="text-xs text-muted-foreground">{account.name}</span>
      </div>
      {/* The timestamp decides this, never the row count — an empty list is
          "nobody looked" until `orders_as_of` says otherwise. */}
      <p className="mb-1 text-xs text-muted-foreground">
        {ordersCoverageSentence(known, orders.length, committed.working)}
      </p>
      {committed.working > 0 && (
        // Informational only (rule 8): displayed, never subtracted from cash.
        // The broker's buying power already reflects it.
        <p className="mb-3 text-xs text-muted-foreground">
          {committed.total === null
            ? `Committed cash cannot be stated — ${committed.unpriced} working ${committed.unpriced === 1 ? "order has" : "orders have"} no knowable cost (market or stop).`
            : `Committed to working buys: ${fmtUSD(committed.total)}.`}
        </p>
      )}
      {fillsShort && (
        <p className="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {fillsShort}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {orders.length === 0 ? "No orders on file." : "No working orders."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Side</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
                <TableHead className="text-right">Limit</TableHead>
                <TableHead className="text-right">Committed</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Placed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((o) => {
                const orderFills = fillsOf(read, o.id);
                const summary = fillSummary(orderFills, o);
                const agreement =
                  summary.state === "recorded"
                    ? averageAgreement(summary.average, o.average_fill_price)
                    : "unknown";
                const cash = committedCash(o);
                return (
                  <Fragment key={o.id}>
                    <TableRow>
                      <TableCell>{sideLabel(o.side)}</TableCell>
                      <TableCell className="font-medium">{o.symbol}</TableCell>
                      <TableCell>{o.order_type}</TableCell>
                      <TableCell className="text-right tabular">{fmtQty(o.quantity)}</TableCell>
                      <TableCell className="text-right tabular">
                        {fmtQty(remainingQuantity(o))}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {o.limit_price === null ? "—" : fmtPrice(o.limit_price)}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {cash === null ? "—" : cash === 0 ? "" : fmtUSD(cash)}
                      </TableCell>
                      {/* Text, never colour alone. */}
                      <TableCell>{statusLabel(o.status)}</TableCell>
                      <TableCell>{fmtWhen(o.placed_at)}</TableCell>
                    </TableRow>
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={9} className="pt-0 text-[11px] text-muted-foreground">
                        {fillSentence(summary)}
                        {summary.state === "recorded" && agreement === "agrees"
                          ? " Average price agrees with the broker's."
                          : null}
                        {summary.state === "recorded" &&
                        agreement === "differs" &&
                        summary.average !== null &&
                        o.average_fill_price !== null
                          ? ` Average from fills ${fmtPrice(summary.average)} differs from the broker's ${fmtPrice(o.average_fill_price)}.`
                          : null}
                      </TableCell>
                    </TableRow>
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {closed.length > 0 && (
        <div className="mt-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowClosed((v) => !v)}
            aria-expanded={showClosed}
          >
            {showClosed
              ? "Hide closed orders"
              : `Show ${closed.length} closed order${closed.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      )}
    </div>
  );
}
