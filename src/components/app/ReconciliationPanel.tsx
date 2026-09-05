// The reconciliation panel (Phase 3d, rule 12).
//
// Replaces `ReconciliationBanner`, which had three messages for two outcomes
// and ended with the line "Treat the broker's figure as correct."
//
// That line is the reason this component exists. Rules 5 and 6 say neither
// value is assumed correct — the broker's figure can be stale, can predate a
// transfer, and can itself be wrong. Telling the user which number to believe
// is the app making a judgement it has no basis for, in the one place whose job
// is to say the two disagree.
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";

import { useAccountScope } from "@/contexts/AccountContext";
import { useAccounts, useLatestBalance } from "@/hooks/useAppData";
import type { AccountTotals } from "@/lib/accountTotals";
import { fmtPct, fmtUSD } from "@/lib/finance";
import {
  DEFAULT_TOLERANCE,
  reconcileAccount,
  reconciliationHeadline,
  wasChecked,
  type ReconciliationStatus,
} from "@/lib/reconciliation";
import { reconciliationInputFor } from "@/lib/reconciliationInput";
import { usdOrUnavailable } from "@/lib/unavailable";

/** Colour by what the status MEANS, not by severity alone: the four unchecked
 *  states share a look, because they share an implication — nothing was
 *  verified — and only the three checked ones earn green or red. */
const TONE: Record<ReconciliationStatus, string> = {
  RECONCILED: "border-emerald-500/30 bg-emerald-500/10",
  WARNING: "border-amber-500/40 bg-amber-500/10",
  NOT_RECONCILED: "border-destructive/40 bg-destructive/10",
  DATA_INCOMPLETE: "border-border bg-card/60",
  STALE: "border-border bg-card/60",
  UNSUPPORTED: "border-border bg-card/60",
  ERROR: "border-destructive/40 bg-destructive/10",
};

export function ReconciliationPanel({ totals }: { totals: AccountTotals | null }) {
  const scope = useAccountScope();
  const { data: accounts = [] } = useAccounts();
  const { data: latest, isLoading } = useLatestBalance(scope);
  const [open, setOpen] = useState(false);

  if (scope.kind !== "account" || isLoading) return null;
  const account = accounts.find((a) => a.id === scope.accountId) ?? null;

  // Built by `reconciliationInputFor` rather than inline, because the
  // readiness gate (Phase 5, rule 17) reconciles the same account and two
  // copies of this mapping would eventually disagree about what the app is
  // comparing — while both rendered a confident status.
  const result = reconcileAccount(
    reconciliationInputFor({
      latestValue: latest?.total_account_value ?? null,
      latestAsOf: latest?.imported_at ?? null,
      account,
      calculatedValue: totals?.totalAccountValue ?? null,
    }),
    DEFAULT_TOLERANCE,
  );

  const age = latest?.imported_at
    ? formatDistanceToNow(new Date(latest.imported_at), { addSuffix: true })
    : null;

  return (
    <div className={`mb-3 rounded-xl border px-4 py-3 text-xs ${TONE[result.status]}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {reconciliationHeadline(result)}{" "}
          <span className="font-normal text-muted-foreground">— {scope.accountName}</span>
        </span>
        <button
          type="button"
          className="underline underline-offset-2 hover:no-underline"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "Hide detail" : "Show detail"}
        </button>
      </div>

      {/* The two figures, side by side and equally weighted. Neither is
          presented as the answer — that is the whole point of showing both. */}
      <div className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-3">
        <Figure label="Broker reports" value={result.externalEquity} />
        <Figure label="This app computes" value={result.calculatedEquity} />
        <Figure
          label="Difference"
          value={result.differenceUsd}
          hint={
            result.differencePct === null
              ? undefined
              : `${fmtPct(Math.abs(result.differencePct), 3)} of the broker's figure`
          }
        />
      </div>

      {result.blockedBy.length > 0 && (
        // Named, not summarised. "Could not reconcile" is not actionable;
        // "no broker figure has been imported" is.
        <p className="mt-2 text-muted-foreground">{result.blockedBy.join(" · ")}</p>
      )}

      {wasChecked(result.status) && result.status !== "RECONCILED" && (
        <p className="mt-2 text-muted-foreground">
          {(result.differenceUsd ?? 0) > 0
            ? "The app holds more than the broker reports — usually a position that was sold, or a price held high."
            : "The app holds less than the broker reports — usually a position not yet imported, or cash the app does not know about."}{" "}
          {/* Deliberately NOT "treat the broker's figure as correct", which the
              banner this replaces used to say. The broker's number can be
              stale, can predate a transfer, and can be wrong; the app has no
              basis for picking a winner and should not pretend to. */}
          Both figures are shown because either could be the wrong one.
        </p>
      )}

      {open && (
        <div className="mt-3 space-y-2 border-t pt-2">
          <div>
            <div className="font-medium">How the app's figure is built</div>
            <div className="mt-1 grid gap-x-6 gap-y-1 sm:grid-cols-3">
              <Figure label="Investments" value={totals?.positionsValue ?? null} />
              <Figure label="Cash" value={totals?.cash ?? null} />
              <Figure label="Margin loan" value={totals?.marginDebit ?? null} />
            </div>
          </div>

          <div>
            {/* Rule 12: shown SEPARATELY and never summed into equity. They are
                figures about capacity and constraint, not about what the
                account is worth — buying power is what could be borrowed, not
                money held. */}
            <div className="font-medium">
              Capacity and constraints{" "}
              <span className="font-normal text-muted-foreground">
                — shown separately; never part of the account value
              </span>
            </div>
            <div className="mt-1 grid gap-x-6 gap-y-1 sm:grid-cols-3">
              <Figure label="Buying power" value={totals?.availableCapital ?? null} />
              <Figure
                label="Available without borrowing"
                value={totals?.availableWithoutBorrowing ?? null}
              />
              <Figure
                label="Committed to open orders"
                value={latest?.committed_to_open_orders ?? null}
              />
            </div>
          </div>

          <p className="text-muted-foreground">
            Broker figure {age ? `imported ${age}` : "never imported"}
            {account?.balances_as_of
              ? ` · app figures as of ${account.balances_as_of.slice(0, 10)}`
              : " · the app's figures have no recorded age"}
            .
          </p>
        </div>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | null;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="tabular font-medium">{usdOrUnavailable(value)}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
