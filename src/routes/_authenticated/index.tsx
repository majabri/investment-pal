import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { RefreshCw, Sparkles, Plus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

import { AppShell } from "@/components/app/AppShell";
import { supabase } from "@/lib/supabaseClient";
import { activeBuybackBySymbol, type TrimDecision } from "@/lib/buybackZones";
import { localIsoDate } from "@/lib/localDate";
import {
  AllocationPanel,
  BalanceOverTime,
  EventsPanel,
  PerformancePanel,
  SummaryHeader,
  SummaryMetricRow,
} from "@/components/app/summary/SummaryPanels";
import { SnapshotRecorder } from "@/components/app/SnapshotRecorder";
import { WorkflowButtons } from "@/components/app/WorkflowButtons";
import { useQuery } from "@tanstack/react-query";
import { getQuotesFn } from "@/lib/marketServer";
import { getEarningsCalendarFn, getEconCalendarFn } from "@/lib/calendarServer";
import { useAccountContext, useAccountScope } from "@/contexts/AccountContext";
import { AccountNotice } from "@/components/app/AccountNotice";
import { ReconciliationPanel } from "@/components/app/ReconciliationPanel";
import { Button } from "@/components/ui/button";
import { marginInterestFigure, rateStatus } from "@/lib/marginCost";
import { balanceSeries, dayChange } from "@/lib/portfolioSummary";
import { accountTotals, scopeIsEmpty, scopeLabel,
  livePriceOf,
} from "@/lib/accountTotals";
import { constitutionCheck, positionsStaleDays } from "@/lib/constitutionCheck";
import {
  AlertChips,
  BuybackStrip,
  TodaysPlanStrip,
} from "@/components/app/dashboard/DashboardStrips";
import { HouseholdStrip } from "@/components/app/dashboard/HouseholdStrip";
import { householdRollup } from "@/lib/householdTotals";
import { CommandCenterStrip } from "@/components/app/dashboard/CommandCenterStrip";
import { GoalOutlookPanel } from "@/components/app/dashboard/GoalOutlookPanel";
import { PrioritiesPanel } from "@/components/app/dashboard/PrioritiesPanel";
import {
  useGoal,
  useProfile,
  useAllHoldings,
  useScopedHoldings,
  useScopedAccount,
  useLatestBalance,
  useCashFlows,
  useSnapshots,
  useUnscopedSnapshotCount,
  useAccounts,
  usePriorities,
  useRecommendedActions,
  useLogSync,
  useIpsLite,
} from "@/hooks/useAppData";
import {
  requiredCAGRWithContrib,
  yearsBetween,
  probabilityOfReachingTarget,
  riskToVol,
  riskToExpectedReturn,
} from "@/lib/finance";
import { objectiveOf } from "@/lib/objective";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Morning Brief — Investment Companion" },
      { name: "description", content: "Today's portfolio brief and priorities." },
    ],
  }),
  component: Dashboard,
});

const CATEGORY_META: Record<string, { label: string; className: string }> = {
  review: { label: "Review", className: "bg-primary/15 text-primary" },
  buy: { label: "Buy candidate", className: "bg-success/20 text-success" },
  hold: { label: "Hold", className: "bg-muted text-muted-foreground" },
  reduce: { label: "Reduce", className: "bg-destructive/20 text-destructive" },
  watch: { label: "Watch", className: "bg-warning/20 text-warning" },
};

function Dashboard() {
  const navigate = useNavigate();
  const { data: goal } = useGoal();
  const { data: profile } = useProfile();
  const displayName = profile?.display_name?.trim() ?? "";
  // Household-wide, and only for the quote request below — every figure on
  // this page is scoped. Reading `allHoldings` into a total is the bug.
  const { data: allHoldings = [] } = useAllHoldings();
  const { data: accountsList = [] } = useAccounts();
  const { data: ipsLite } = useIpsLite();
  // The dashboard tracks the selected account only (each other account has its
  // own screen). An unresolved selection yields no holdings and an explicit
  // notice — it must never fall back to accountless rows or to the household
  // aggregate, both of which rendered a plausible but wrong portfolio with no
  // error.
  const { status: accountStatus } = useAccountContext();
  const scope = useAccountScope();
  const { data: holdings } = useScopedHoldings(scope);
  const { data: balance } = useScopedAccount(scope);
  // The broker's own accrued-interest figure, when a balance has been
  // imported. Preferred over the app's estimate below (Stage 3 delta).
  const { data: latestBalance } = useLatestBalance(scope);
  const { data: snapshots = [], isError: snapshotsError } = useSnapshots(scope);
  // PERF-001: UNKNOWN until the account's flow history is marked complete on
  // the Portfolio page, and the panel says so rather than reporting a deposit
  // as return. The migration is applied; what gates this now is
  // `accounts.cash_flows_as_of`, which recording a flow deliberately does not
  // set — a partial history produces rows too.
  const { data: cashFlows } = useCashFlows(scope);
  const { data: unscopedCount = 0 } = useUnscopedSnapshotCount();
  const series = useMemo(() => balanceSeries(snapshots), [snapshots]);
  const { data: priorities = [], dismiss: dismissPriority } = usePriorities();
  const { data: actions = [], dismiss: dismissAction } = useRecommendedActions();
  const logSync = useLogSync();

  const householdSymbols = useMemo(
    () => [...new Set(allHoldings.map((h) => h.symbol))],
    [allHoldings],
  );
  const heldSymbols = useMemo(() => holdings.map((h) => h.symbol), [holdings]);
  const { data: liveQuotes } = useQuery({
    queryKey: ["daily-quotes", householdSymbols.join(",")],
    queryFn: () => getQuotesFn({ data: { symbols: householdSymbols } }),
    enabled: householdSymbols.length > 0,
    refetchInterval: 60 * 1000,
  });
  const px = (h: { symbol: string; current_price: number }) => livePriceOf(h, liveQuotes);
  const week = new Date();
  week.setDate(week.getDate() + 7);
  const weekEnd = localIsoDate(week);
  const todayStr = localIsoDate();
  const { data: todaysPlan = [] } = useQuery({
    queryKey: ["decisions-today"],
    queryFn: async () => {
      const today = localIsoDate();
      const { data } = await supabase
        .from("decisions")
        .select("id,recommendation,decision")
        .eq("decided_on", today)
        .order("id", { ascending: true })
        .limit(12);
      return (data ?? []) as unknown as { id: string; recommendation: string; decision: string }[];
    },
    refetchInterval: 5 * 60 * 1000,
  });
  // Buy-back zones (ADR-APP-003): re-entry ladders from recent valuation/overbought trims.
  const { data: buybackTrims = [] } = useQuery({
    queryKey: ["buyback-trims"],
    queryFn: async (): Promise<TrimDecision[]> => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 45);
      const { data } = await supabase
        .from("decisions")
        .select("id,symbol,action,recommendation,price_at_rec,decided_on")
        .gte("decided_on", localIsoDate(cutoff))
        .not("price_at_rec", "is", null)
        .order("decided_on", { ascending: false })
        .limit(100);
      return (data ?? []) as unknown as TrimDecision[];
    },
  });
  const buybackPlans = Array.from(
    activeBuybackBySymbol(buybackTrims, (sym) => {
      const q = liveQuotes?.[sym]?.price;
      if (q != null) return q;
      const h = holdings.find((x) => x.symbol === sym);
      return h ? px(h) : null;
    }).values(),
  );
  const { data: liveEcon = [] } = useQuery({
    queryKey: ["econ-cal-office"],
    queryFn: () => getEconCalendarFn({ data: { days: 7 } }),
    refetchInterval: 60 * 60 * 1000,
  });
  const { data: liveEarn = [], isLoading: earningsLoading } = useQuery({
    queryKey: ["earn-cal-office", heldSymbols.join(",")],
    queryFn: () => getEarningsCalendarFn({ data: { symbols: heldSymbols, days: 7 } }),
    enabled: heldSymbols.length > 0,
    refetchInterval: 60 * 60 * 1000,
  });
  const alerts = useMemo(() => {
    const econ = liveEcon
      .filter((e) => e.importance === "high" && e.date >= todayStr && e.date <= weekEnd)
      .map((e) => ({ date: e.date, text: e.name, kind: "econ" as const }));
    const earn = liveEarn
      .filter((e) => e.date >= todayStr && e.date <= weekEnd)
      .map((e) => ({
        date: e.date,
        text: `${e.symbol} earnings (${e.session === "bmo" ? "pre-market" : "after close"})`,
        kind: "earnings" as const,
      }));
    const seen = new Set<string>();
    return [...econ, ...earn]
      .sort((a, b) => a.date.localeCompare(b.date))
      .filter((a) => {
        const k = a.text;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 6);
  }, [liveEcon, liveEarn, todayStr, weekEnd]);
  // One reconcilable arithmetic for every figure below, over the scoped
  // positions and the scoped balance, priced live where a quote exists.
  // `cash ?? account?.cash` used to fall through to the household aggregate.
  const totals = useMemo(
    () => accountTotals(holdings, balance, px),
    [holdings, balance, liveQuotes],
  );
  const { cash, marginDebit: marginUsed, grossValue, totalAccountValue: portfolioValue } = totals;
  const scopeName = scopeLabel(scope);
  const noScope = scopeIsEmpty(scope) || balance === null;
  const day = useMemo(() => dayChange(holdings, liveQuotes), [holdings, liveQuotes]);
  // From IPS policy (ADR-APP-007), never a constant — and superseded by
  // Fidelity's own accrued figure when a balance has been imported. The two are
  // never blended and never shown without saying which is which.
  const interest = marginInterestFigure({
    accruedMtd: latestBalance?.margin_interest_accrued_mtd ?? null,
    importedAt: latestBalance?.imported_at ?? null,
    hasImport: Boolean(latestBalance),
    marginUsed,
    policy: ipsLite,
  });

  // An unset objective yields NO metrics rather than metrics computed from
  // defaults. `new Date(null)` is the epoch, so a missing date used to produce
  // a required CAGR measured against 1970 — a confident, enormous, wrong
  // number (rule 13).
  const objective = useMemo(() => objectiveOf(goal), [goal]);
  const goalMetrics = useMemo(() => {
    // The current value is as load-bearing as the objective: every figure below
    // projects FROM it. Without it, `startVal` silently falls back to the
    // objective's own starting value, so the dashboard reports the pace
    // required from the day the goal was written as though it were today's.
    if (objective.kind !== "set" || portfolioValue === null) return null;
    const years = Math.max(yearsBetween(new Date(), new Date(objective.targetDate)), 0.01);
    const startVal = portfolioValue > 0 ? portfolioValue : objective.startingValue;
    const cagr = requiredCAGRWithContrib(
      startVal,
      objective.targetValue,
      years,
      objective.monthlyContribution,
    );
    const prob = probabilityOfReachingTarget(
      startVal,
      objective.targetValue,
      years,
      riskToExpectedReturn(goal!.risk_preference),
      riskToVol(goal!.risk_preference),
    );
    const span = objective.targetValue - objective.startingValue;
    const progress =
      span > 0 ? Math.min(1, Math.max(0, (portfolioValue - objective.startingValue) / span)) : null;
    return { years, cagr, prob, progress };
  }, [objective, goal, portfolioValue]);

  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 5
      ? "Late night"
      : hour < 12
        ? "Good morning"
        : hour < 18
          ? "Good afternoon"
          : "Good evening";

  return (
    <AppShell
      title={displayName ? `${greeting}, ${displayName}` : greeting}
      subtitle="Portfolio summary, then what changed, what matters, and what to do."
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              logSync.mutate(
                { detail: "Manual refresh from dashboard" },
                {
                  onSuccess: () => toast.success("Portfolio marked refreshed"),
                  onError: (e) => toast.error((e as Error).message),
                },
              );
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button
            size="lg"
            className="shadow-md"
            onClick={() => navigate({ to: "/prompt-center" })}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Start Morning Review
          </Button>
        </>
      }
    >
      <AccountNotice status={accountStatus} />
      {/* Invisible: records at most one balance snapshot per account per day. */}
      <SnapshotRecorder gross={grossValue} net={portfolioValue} marginUsed={marginUsed} />
      <ReconciliationPanel totals={totals} />
      <div className="mb-4">
        <WorkflowButtons symbols={holdings.map((h) => h.symbol)} />
      </div>
      {/* The governance strip. Its arithmetic is `lib/constitutionCheck.ts`
          and its rendering is the component — this route resolves the inputs
          and nothing else (audit brief G4). */}
      <CommandCenterStrip
        verdict={constitutionCheck(
          holdings.map((h) => ({ symbol: h.symbol, quantity: h.quantity, price: px(h) })),
          totals,
          ipsLite,
        )}
        equityPct={totals.equityPct}
        marginUsed={marginUsed}
        interest={interest}
        rateState={rateStatus(ipsLite)}
        staleDays={positionsStaleDays(holdings)}
        noScope={noScope}
        scopeName={scopeName}
      />
      {/* Household and per-category totals. One account with an unknown
          balance makes its category and the household UNKNOWN, not smaller —
          the rule lives in `lib/householdTotals.ts` with its tests. */}
      <HouseholdStrip rollup={householdRollup(accountsList, allHoldings, liveQuotes, px)} />
      <TodaysPlanStrip rows={todaysPlan} />
      <BuybackStrip plans={buybackPlans} />
      <AlertChips alerts={alerts} />
      {/* The Portfolio Summary panels (Stage 5b), shared with /summary rather
          than re-implemented. The dashboard's own six stat cards said the same
          things in different words, and two wordings for one figure is how the
          two screens start disagreeing. The decision-support blocks below are
          what this page adds on top of the summary. */}
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
          flows={cashFlows}
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
        {/* The real flag, not a hardcoded `false`. While the query was in
            flight this panel asserted "Nothing you hold reports in the next 30
            days" — a claim about the calendar made before the calendar had
            been read. `/summary` always passed the real one; the dashboard did
            not, which is the load-window shape Task 6 exists to remove. */}
        <EventsPanel earnings={liveEarn} isLoading={earningsLoading} heldCount={holdings.length} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <GoalOutlookPanel goalName={goal ? goal.name : null} metrics={goalMetrics} />
        <PrioritiesPanel priorities={priorities} onDismiss={(id) => dismissPriority.mutate(id)} />
      </div>

      <div className="mt-4 rounded-2xl border bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Recommended actions
            </div>
            <div className="mt-1 text-lg font-semibold">What should I do?</div>
          </div>
          <Link
            to="/settings"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Plus className="h-3 w-3" /> Add
          </Link>
        </div>
        {actions.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No actions queued. Save recommendations from ChatGPT via the Prompt Center or add them
            in Settings.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {actions.map((a) => {
              const meta = CATEGORY_META[a.category] ?? CATEGORY_META.review;
              return (
                <li
                  key={a.id}
                  className="flex items-start justify-between gap-3 rounded-xl border bg-background/40 px-4 py-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
                      >
                        {meta.label}
                      </span>
                      {a.symbol ? (
                        <span className="text-sm font-semibold tabular">{a.symbol}</span>
                      ) : null}
                    </div>
                    {a.rationale ? (
                      <p className="mt-1 text-sm text-muted-foreground">{a.rationale}</p>
                    ) : null}
                  </div>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => dismissAction.mutate(a.id)}
                  >
                    Dismiss
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
