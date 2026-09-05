// Computed total vs the broker's total (Stage 2).
//
// This is the point of the balance import. The app's total is positions + cash
// − debit over the rows it holds; the broker's total is the truth. If they
// differ, the app is missing a position, holding a stale price, or carrying a
// wrong cash figure — and before this, nothing in the app could tell. It showed
// its own number with the same confidence either way.
import { formatDistanceToNow } from "date-fns";

import { useAccountScope } from "@/contexts/AccountContext";
import { useLatestBalance } from "@/hooks/useAppData";
import { reconcile } from "@/lib/balanceImport";
import { fmtUSD } from "@/lib/finance";

export function ReconciliationBanner({ computedTotal }: { computedTotal: number | null }) {
  const scope = useAccountScope();
  const { data: latest, isLoading } = useLatestBalance(scope);

  // No account, or no import yet: say so once, rather than every render
  // implying the figures have been checked.
  if (scope.kind !== "account") return null;
  if (isLoading) return null;

  // The app has no total to offer, so there is nothing to reconcile. This used
  // to arrive as 0 via `?? 0`, which reconciles as a discrepancy the size of the
  // whole account — a loud, precise, entirely fictitious finding pointing at a
  // missing position rather than at the missing cash figure that caused it.
  if (computedTotal === null) {
    return (
      <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs">
        Reconciliation unavailable for {scope.accountName} — the app cannot compute a total account
        value because this account&rsquo;s cash or margin loan is not known. Import a balance block
        in Settings, or record them under &ldquo;Cash &amp; margin&rdquo;.
      </div>
    );
  }
  if (!latest) {
    return (
      <div className="mb-3 rounded-xl border bg-card/60 px-4 py-2 text-xs text-muted-foreground">
        No broker balances imported for {scope.accountName} yet — nothing to reconcile this total
        against. Paste the Fidelity balances block in Settings to check it.
      </div>
    );
  }

  const r = reconcile(latest.total_account_value, computedTotal);
  const age = latest.imported_at
    ? formatDistanceToNow(new Date(latest.imported_at), { addSuffix: true })
    : null;

  if (r.kind === "no-pasted-total") {
    return (
      <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs">
        The last balance import for {scope.accountName}
        {age ? ` (${age})` : ""} did not include a total account value, so this figure has not been
        checked against the broker.
      </div>
    );
  }

  if (r.kind === "matches") {
    return (
      <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs">
        <span className="font-medium text-emerald-600 dark:text-emerald-400">Reconciled</span> · the
        computed total for {scope.accountName} matches the imported Fidelity total of{" "}
        {fmtUSD(r.pasted)}
        {age ? ` (imported ${age})` : ""}.
      </div>
    );
  }

  // Differs. Say by how much and in which direction — "does not reconcile" on
  // its own is not actionable, and the sign says where to look.
  const over = r.delta > 0;
  return (
    <div className="mb-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-xs">
      <span className="font-medium text-destructive">Does not reconcile</span> · this app computes{" "}
      {fmtUSD(r.computed)} for {scope.accountName}; the imported Fidelity total
      {age ? ` (${age})` : ""} is {fmtUSD(r.pasted)} — a difference of {fmtUSD(Math.abs(r.delta))}{" "}
      {over ? "more" : "less"} here than at the broker.{" "}
      {over
        ? "Usually a position that was sold, or a stale price held high."
        : "Usually a position that has not been imported, or cash the app does not know about."}{" "}
      Treat the broker's figure as correct.
    </div>
  );
}
