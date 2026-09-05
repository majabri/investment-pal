import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { RefreshCw, Sparkles, Plus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

import { AppShell } from "@/components/app/AppShell";
import { supabase } from "@/lib/supabaseClient";
import { activeBuybackBySymbol, type TrimDecision } from "@/lib/buybackZones";
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
import { accountCategory, CATEGORY_ORDER } from "@/lib/data/accountGroups";
import { useAccountContext, useAccountScope } from "@/contexts/AccountContext";
import { AccountNotice } from "@/components/app/AccountNotice";
import { ReconciliationBanner } from "@/components/app/ReconciliationBanner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { interestProvenanceShort, marginInterestFigure, rateStatus } from "@/lib/marginCost";
import { balanceSeries, dayChange } from "@/lib/portfolioSummary";
import { accountTotals, scopeIsEmpty, scopeLabel } from "@/lib/accountTotals";
import {
  useGoal,
  useProfile,
  useAllHoldings,
  useScopedHoldings,
  useScopedAccount,
  useLatestBalance,
  useSnapshots,
  useUnscopedSnapshotCount,
  useAccounts,
  usePriorities,
  useRecommendedActions,
  useLogSync,
  useIpsLite,
} from "@/hooks/useAppData";
import {
  fmtUSD,
  fmtPct,
  requiredCAGRWithContrib,
  yearsBetween,
  probabilityOfReachingTarget,
  riskToVol,
  riskToExpectedReturn,
} from "@/lib/finance";
import { UNAVAILABLE } from "@/lib/unavailable";
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
  const px = (h: { symbol: string; current_price: number }) =>
    liveQuotes?.[h.symbol]?.price ?? h.current_price;
  const week = new Date();
  week.setDate(week.getDate() + 7);
  const weekEnd = week.toISOString().slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);
  const { data: todaysPlan = [] } = useQuery({
    queryKey: ["decisions-today"],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from("decisions" as never)
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
        .from("decisions" as never)
        .select("id,symbol,action,recommendation,price_at_rec,decided_on")
        .gte("decided_on", cutoff.toISOString().slice(0, 10))
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
  const { data: liveEarn = [] } = useQuery({
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
      <ReconciliationBanner computedTotal={portfolioValue} />
      <div className="mb-4">
        <WorkflowButtons symbols={holdings.map((h) => h.symbol)} />
      </div>
      {(() => {
        // ── Command-center strip: freshness · margin meter · constitution check ──
        // Same `totals` as the stat cards — recomputing here is how the strip
        // and the cards used to disagree about the same account.
        const scopedHoldings = holdings;
        const gross = grossValue;
        const net = portfolioValue;
        // NOT `?? 1`. Assuming full equity when it is unknown makes the
        // "equity below 50%" breach unfireable on exactly the accounts whose
        // data is missing — a governance check that passes because it checked
        // nothing is worse than one that fails.
        const equityPct = totals.equityPct;
        // Whether the constitution can be checked at all. Every limit below is
        // a fraction of the account value, so an unknown value means unchecked,
        // not clean.
        const checkable = net !== null && marginUsed !== null;
        const rateState = rateStatus(ipsLite);
        const lastUpdate = scopedHoldings.reduce<string | null>((m, h) => {
          const u = (h as { updated_at?: string }).updated_at ?? null;
          return u && (!m || u > m) ? u : m;
        }, null);
        const staleDays = lastUpdate
          ? Math.floor((Date.now() - new Date(lastUpdate).getTime()) / 86400000)
          : null;
        const breaches: string[] = [];
        // IPS-lite (ADR-APP-004): configurable soft/hard position cap + margin cap.
        const posCap = ipsLite.position_cap_pct / 100;
        for (const h of scopedHoldings) {
          const v = h.quantity * px(h);
          if (net !== null && net > 0 && v / net > posCap)
            breaches.push(
              `${h.symbol} ${fmtPct(v / net)} > ${ipsLite.position_cap_pct}% cap${ipsLite.position_cap_hard ? " (HARD)" : ""}`,
            );
        }
        const marginUtil =
          net !== null && net > 0 && marginUsed !== null ? marginUsed / net : null;
        if (marginUsed !== null && marginUsed > 0 && marginUtil !== null)
          if (marginUtil > ipsLite.margin_cap_pct / 100)
            breaches.push(`Margin util ${fmtPct(marginUtil)} > ${ipsLite.margin_cap_pct}% cap`);
        if (marginUsed !== null && marginUsed > 0 && equityPct !== null && equityPct < 0.5)
          breaches.push(`Equity ${fmtPct(equityPct)} < 50%`);
        return (
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border bg-card/60 px-4 py-2 text-xs">
            <span
              className={
                staleDays != null && staleDays >= 1
                  ? "font-medium text-amber-500"
                  : "text-muted-foreground"
              }
            >
              Positions:{" "}
              {staleDays == null
                ? "never imported"
                : staleDays === 0
                  ? "imported today"
                  : `imported ${staleDays}d ago`}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              Margin{" "}
              {/* Provenance wording comes from marginCost, never from here —
                  a call site that writes its own is how "(estimate)" quietly
                  stops appearing on one screen. */}
              {marginUsed === null
                ? "not known"
                : marginUsed > 0
                  ? `${fmtUSD(marginUsed)} · ${
                    interest.kind === "actual"
                      ? `${fmtUSD(interest.accruedMtd, 2)} interest this month`
                      : interest.kind === "estimate"
                        ? `~${fmtUSD(interest.daily, 2)}/day interest`
                        : "no interest figure"
                    } (${interestProvenanceShort(interest)}) · equity ${
                      equityPct === null ? UNAVAILABLE : fmtPct(equityPct)
                    }`
                  : "not set"}
            </span>
            <span className="text-muted-foreground">·</span>
            {/* Rate staleness, flagged only when there is a margin balance for
                it to matter to. Amber, not red: an ageing rate is a prompt to
                re-check, not a policy breach — those keep red to themselves. */}
            {marginUsed !== null && marginUsed > 0 && rateState.kind === "stale" ? (
              <>
                <span className="font-medium text-amber-500">
                  Margin rate {rateState.ageDays}d old
                </span>
                <span className="text-muted-foreground">·</span>
              </>
            ) : null}
            {marginUsed !== null && marginUsed > 0 && rateState.kind === "unset" ? (
              <>
                <Link to="/settings" className="font-medium text-amber-500 hover:underline">
                  Set margin rate →
                </Link>
                <span className="text-muted-foreground">·</span>
              </>
            ) : null}
            {/* "Constitution: clean" over an unresolved scope asserts that
                nothing breached, having checked nothing. Say which scope
                instead. */}
            {noScope ? (
              <span className="text-muted-foreground">Constitution: {scopeName.toLowerCase()}</span>
            ) : !checkable ? (
              /* "clean" here would assert that nothing breached, having been
                 unable to evaluate a single limit. */
              <span className="font-medium text-amber-500">
                Constitution: not checked — account value unknown
              </span>
            ) : breaches.length === 0 ? (
              <span className="text-emerald-500">Constitution: clean</span>
            ) : (
              <span className="font-medium text-red-500">⚠ {breaches.join(" · ")}</span>
            )}
            {(staleDays == null || staleDays >= 1) && (
              <Link to="/settings" className="ml-auto font-medium text-primary hover:underline">
                Import now →
              </Link>
            )}
          </div>
        );
      })()}
      {accountsList.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border bg-card/60 px-4 py-2 text-sm">
          {(() => {
            const statsOf = (a: (typeof accountsList)[number]) => {
              const rows = allHoldings.filter((h) => h.account_id === a.id);
              const pos = rows.reduce((x, h) => x + h.quantity * px(h), 0);
              const day = rows.reduce((x, h) => {
                const q = liveQuotes?.[h.symbol];
                return q && q.prevClose > 0 ? x + h.quantity * (q.price - q.prevClose) : x;
              }, 0);
              return { net: pos + Number(a.cash ?? 0) - Number(a.margin_used ?? 0), day };
            };
            const groups = new Map<string, { net: number; day: number }>();
            let total = 0,
              totalDay = 0;
            for (const a of accountsList) {
              const { net, day } = statsOf(a);
              total += net;
              totalDay += day;
              const cat = accountCategory(a);
              const g = groups.get(cat) ?? { net: 0, day: 0 };
              g.net += net;
              g.day += day;
              groups.set(cat, g);
            }
            const Day = ({ v }: { v: number }) =>
              Math.abs(v) < 0.005 ? null : (
                <span className={v >= 0 ? "text-emerald-500" : "text-red-500"}>
                  {" "}
                  {v >= 0 ? "+" : ""}
                  {fmtUSD(v)}
                </span>
              );
            return (
              <>
                <span className="font-medium">
                  Household {fmtUSD(total)}
                  <Day v={totalDay} />
                </span>
                {CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => (
                  <span key={c} className="text-muted-foreground">
                    {c}{" "}
                    <span className="tabular-nums text-foreground">
                      {fmtUSD(groups.get(c)!.net)}
                    </span>
                    <Day v={groups.get(c)!.day} />
                  </span>
                ))}
              </>
            );
          })()}
        </div>
      )}
      {todaysPlan.length > 0 && (
        <div className="mb-4 rounded-xl border bg-card/60 px-4 py-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Today's Plan — committee Action Sheet
          </div>
          <ul className="space-y-0.5 text-sm">
            {todaysPlan.map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <span className={d.decision === "pending" ? "text-amber-500" : "text-emerald-500"}>
                  ●
                </span>
                <span>{d.recommendation}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {buybackPlans.length > 0 && (
        <div className="mb-4 rounded-xl border bg-card/60 px-4 py-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Buy-back zones — re-entry ladder after trims (advisory)
          </div>
          <ul className="space-y-1 text-sm">
            {buybackPlans.map((p) => (
              <li key={p.symbol} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span className="font-medium">{p.symbol}</span>
                <span className="text-xs text-muted-foreground">
                  trim {p.decidedOn.slice(5)} @ ~{fmtUSD(p.anchor, 2)}
                </span>
                {p.zones.map((z) => (
                  <span
                    key={z.pct}
                    className={
                      z.status === "hit" ? "font-medium text-emerald-500" : "text-muted-foreground"
                    }
                  >
                    {z.pct}% {fmtUSD(z.price, 2)}
                    {z.status === "hit" ? " ✓ reached" : ""}
                  </span>
                ))}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Anchor ≈ logged trim price (your Fidelity fill may differ). Advisory only — you execute.
            Expires after 30 days or when the thesis invalidates.
          </p>
        </div>
      )}
      {alerts.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {alerts.map((a) => (
            <span
              key={a.text + a.date}
              className={`rounded-full border px-3 py-1 text-xs ${a.kind === "econ" ? "border-warning/40 bg-warning/10" : "border-primary/30 bg-primary/10"}`}
            >
              <span className="font-medium">{a.date.slice(5)}</span> · {a.text}
            </span>
          ))}
        </div>
      )}
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
        <EventsPanel earnings={liveEarn} isLoading={false} heldCount={holdings.length} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border bg-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Goal outlook
              </div>
              <div className="mt-1 text-lg font-semibold">{goal ? goal.name : "No goal"}</div>
            </div>
            <Link to="/goals" className="text-xs text-primary hover:underline">
              Edit goal →
            </Link>
          </div>
          {goal && goalMetrics ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <div className="text-xs text-muted-foreground">Required CAGR</div>
                <div className="mt-1 text-xl font-semibold tabular">{fmtPct(goalMetrics.cagr)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Probability of success</div>
                <div className="mt-1 text-xl font-semibold tabular text-primary">
                  {fmtPct(goalMetrics.prob)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Time remaining</div>
                <div className="mt-1 text-xl font-semibold tabular">
                  {goalMetrics.years.toFixed(2)} yrs
                </div>
              </div>
              {goalMetrics.progress === null ? null : (
                // No bar at all when progress cannot be computed. A bar at 0%
                // is a claim of no progress, which is not what "unknown" means.
                <div className="sm:col-span-3">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${(goalMetrics.progress * 100).toFixed(1)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Head to{" "}
              <Link to="/goals" className="text-primary hover:underline">
                Goals
              </Link>{" "}
              to set your target.
            </p>
          )}
        </div>

        <div className="rounded-2xl border bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Today's priorities
            </div>
            <Link to="/settings" className="text-xs text-muted-foreground hover:text-foreground">
              Manage
            </Link>
          </div>
          <ul className="mt-3 space-y-2">
            {priorities.length === 0 && (
              <li className="text-sm text-muted-foreground">
                Nothing flagged. Add priorities on the Settings page.
              </li>
            )}
            {priorities.map((p) => (
              <li
                key={p.id}
                className="flex items-start justify-between gap-2 rounded-lg border bg-background/40 px-3 py-2"
              >
                <div className="flex items-start gap-2">
                  <Badge
                    variant="outline"
                    className={
                      p.severity === "critical"
                        ? "border-destructive/40 text-destructive"
                        : p.severity === "warning"
                          ? "border-warning/40 text-warning"
                          : "border-primary/30 text-primary"
                    }
                  >
                    {p.severity}
                  </Badge>
                  <span className="text-sm">{p.label}</span>
                </div>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => dismissPriority.mutate(p.id)}
                >
                  Done
                </button>
              </li>
            ))}
          </ul>
        </div>
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
