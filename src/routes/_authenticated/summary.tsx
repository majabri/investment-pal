// Portfolio Summary (Stage 5).
//
// Six panels over ONE account: header, metric row, balance over time,
// performance, asset allocation, portfolio events. The panels themselves live
// in `components/app/summary/SummaryPanels.tsx` and are shared with the Morning
// Brief, so the two surfaces cannot drift into two approximations of the same
// screen. This route is data wiring.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/app/AppShell";
import { AccountNotice } from "@/components/app/AccountNotice";
import { ReconciliationPanel } from "@/components/app/ReconciliationPanel";
import { SnapshotRecorder } from "@/components/app/SnapshotRecorder";
import {
  AllocationPanel,
  BalanceOverTime,
  EventsPanel,
  PerformancePanel,
  SummaryHeader,
  SummaryMetricRow,
} from "@/components/app/summary/SummaryPanels";
import { useAccountContext, useAccountScope } from "@/contexts/AccountContext";
import {
  useGoal,
  useIpsLite,
  useLatestBalance,
  useScopedAccount,
  useScopedHoldings,
  useSnapshots,
  useUnscopedSnapshotCount,
} from "@/hooks/useAppData";
import { accountTotals, scopeIsEmpty, scopeLabel, type AccountScope } from "@/lib/accountTotals";
import { getEarningsCalendarFn } from "@/lib/calendarServer";
import { getQuotesFn } from "@/lib/marketServer";
import { marginInterestFigure } from "@/lib/marginCost";
import { balanceSeries, dayChange } from "@/lib/portfolioSummary";
import { objectiveOf } from "@/lib/objective";

export const Route = createFileRoute("/_authenticated/summary")({
  head: () => ({
    meta: [
      { title: "Portfolio Summary — Investment Companion" },
      {
        name: "description",
        content: "Balances, performance, allocation and events for one account.",
      },
    ],
  }),
  component: SummaryPage,
});

function SummaryPage() {
  const { status: accountStatus } = useAccountContext();
  const selected = useAccountScope();
  // This page is about ONE account, and its title says so. Anything that is not
  // a single account resolves to no scope rather than being allowed to blend:
  // otherwise the metric row would show a household total while the chart and
  // performance panels — which require an account_id — reported no data, and
  // the two halves of the page would be describing different things.
  const scope: AccountScope = selected.kind === "account" ? selected : { kind: "none" };
  const noScope = scopeIsEmpty(scope);

  const { data: holdings } = useScopedHoldings(scope, { includeUnassigned: true });
  const { data: balance } = useScopedAccount(scope);
  const { data: snapshots = [], isError: snapshotsError } = useSnapshots(scope);
  const { data: unscopedCount = 0 } = useUnscopedSnapshotCount();
  const { data: latestBalance } = useLatestBalance(scope);
  const { data: ipsLite } = useIpsLite();
  const { data: goal } = useGoal();
  const objective = useMemo(() => objectiveOf(goal), [goal]);

  const symbols = useMemo(() => [...new Set(holdings.map((h) => h.symbol))], [holdings]);
  const { data: quotes } = useQuery({
    queryKey: ["summary-quotes", symbols.join(",")],
    queryFn: () => getQuotesFn({ data: { symbols } }),
    enabled: symbols.length > 0,
    refetchInterval: 60 * 1000,
  });
  const px = (h: { symbol: string; current_price: number }) =>
    quotes?.[h.symbol]?.price ?? h.current_price;

  const totals = useMemo(
    () => (balance === null ? null : accountTotals(holdings, balance, px)),
    [holdings, balance, quotes],
  );
  const day = useMemo(() => dayChange(holdings, quotes), [holdings, quotes]);
  const series = useMemo(() => balanceSeries(snapshots), [snapshots]);
  const interest = marginInterestFigure({
    accruedMtd: latestBalance?.margin_interest_accrued_mtd ?? null,
    importedAt: latestBalance?.imported_at ?? null,
    hasImport: Boolean(latestBalance),
    // `?? 0` would estimate the cost of borrowing as nil for an account whose
    // loan is unknown (Phase 1a).
    marginUsed: totals?.marginDebit ?? null,
    policy: ipsLite,
  });

  const { data: earnings = [], isLoading: earningsLoading } = useQuery({
    queryKey: ["summary-earnings", symbols.join(",")],
    queryFn: () => getEarningsCalendarFn({ data: { symbols, days: 30 } }),
    enabled: symbols.length > 0,
    refetchInterval: 60 * 60 * 1000,
  });

  return (
    <AppShell
      title="Portfolio Summary"
      subtitle={`${scopeLabel(scope)} · balances, performance, allocation and what is coming up`}
    >
      <AccountNotice status={accountStatus} />
      {/* One writer for the series, shared with the Morning Brief. Two writers
          with slightly different "already recorded today?" checks is how a
          series acquires duplicate days that then disagree. */}
      {/* Nulls, not zeroes. A snapshot is a permanent append-only row, and one
          derived from an unknown balance is a wrong day in the series that
          every later chart and reconciliation reads as fact. */}
      <SnapshotRecorder
        gross={totals?.grossValue ?? null}
        net={totals?.totalAccountValue ?? null}
        marginUsed={totals?.marginDebit ?? null}
      />
      <ReconciliationPanel totals={totals ?? null} />

      <SummaryHeader scope={scope} totals={totals} day={day} />
      <SummaryMetricRow scope={scope} totals={totals} interest={interest} policy={ipsLite} />

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <BalanceOverTime
            scope={scope}
            series={series}
            unscopedCount={unscopedCount}
            isError={snapshotsError}
          />
        </div>
        <PerformancePanel
          series={series}
          totals={totals}
          objective={
            objective.kind === "set"
              ? {
                  starting_value: objective.startingValue,
                  target_value: objective.targetValue,
                  target_date: objective.targetDate,
                }
              : null
          }
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <AllocationPanel positions={holdings} priceOf={px} noScope={noScope} />
        <EventsPanel earnings={earnings} isLoading={earningsLoading} heldCount={holdings.length} />
      </div>
    </AppShell>
  );
}
