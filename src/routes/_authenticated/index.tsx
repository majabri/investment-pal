import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Target as TargetIcon,
  ShieldAlert,
  RefreshCw,
  Sparkles,
  Plus,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

import { AppShell } from "@/components/app/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { activeBuybackBySymbol, type TrimDecision } from "@/lib/buybackZones";
import { StatCard } from "@/components/app/StatCard";
import { ProgressChart } from "@/components/app/ProgressChart";
import { WorkflowButtons } from "@/components/app/WorkflowButtons";
import { useQuery } from "@tanstack/react-query";
import { getQuotesFn } from "@/lib/marketServer";
import { getEarningsCalendarFn, getEconCalendarFn } from "@/lib/calendarServer";
import { accountCategory, CATEGORY_ORDER } from "@/lib/data/accountGroups";
import { useAccountContext, selectAccountHoldings } from "@/contexts/AccountContext";
import { AccountNotice } from "@/components/app/AccountNotice";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useGoal,
  useProfile,
  useHoldings,
  useAccount,
  useAccounts,
  usePriorities,
  useRecommendedActions,
  useLogSync,
  useIpsLite,
} from "@/hooks/useAppData";
import {
  fmtUSD,
  fmtPct,
  requiredCAGR,
  requiredCAGRWithContrib,
  yearsBetween,
  probabilityOfReachingTarget,
  riskToVol,
  riskToExpectedReturn,
  marginStatus,
} from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Morning Brief — Investment Companion" },
      { name: "description", content: "Today's portfolio brief and priorities." },
    ],
  }),
  component: Dashboard,
});

const CATEGORY_META: Record<
  string,
  { label: string; className: string }
> = {
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
  const { data: allHoldings = [] } = useHoldings();
  const { data: accountsList = [] } = useAccounts();
  const { data: ipsLite } = useIpsLite();
  // The dashboard tracks the selected account only (each other account has its
  // own screen). An unresolved selection yields no holdings and an explicit
  // notice — it must never fall back to accountless rows, which used to render
  // a plausible but wrong portfolio with no error.
  const { selectedAccount, status: accountStatus } = useAccountContext();
  const holdings = useMemo(
    () => selectAccountHoldings(allHoldings, selectedAccount?.id ?? null),
    [allHoldings, selectedAccount],
  );
  const { data: account } = useAccount();
  const { data: priorities = [], dismiss: dismissPriority } = usePriorities();
  const { data: actions = [], dismiss: dismissAction } = useRecommendedActions();
  const logSync = useLogSync();

  const positionsValue = useMemo(
    () => holdings.reduce((sum, h) => sum + h.quantity * h.current_price, 0),
    [holdings],
  );
  const costBasisTotal = useMemo(
    () => holdings.reduce((sum, h) => sum + h.quantity * h.cost_basis, 0),
    [holdings],
  );
  const householdSymbols = useMemo(() => [...new Set(allHoldings.map((h) => h.symbol))], [allHoldings]);
  const heldSymbols = useMemo(() => holdings.map((h) => h.symbol), [holdings]);
  const { data: liveQuotes } = useQuery({
    queryKey: ["daily-quotes", householdSymbols.join(",")],
    queryFn: () => getQuotesFn({ data: { symbols: householdSymbols } }),
    enabled: householdSymbols.length > 0,
    refetchInterval: 60 * 1000,
  });
  const px = (h: { symbol: string; current_price: number }) => liveQuotes?.[h.symbol]?.price ?? h.current_price;
  const dailyPL = useMemo(() => {
    if (!liveQuotes) return null;
    let sum = 0, covered = 0;
    for (const h of holdings) {
      const q = liveQuotes[h.symbol];
      if (q && q.prevClose > 0) { sum += h.quantity * (q.price - q.prevClose); covered++; }
    }
    return covered > 0 ? { sum, covered, total: holdings.length } : null;
  }, [liveQuotes, holdings]);
  const week = new Date(); week.setDate(week.getDate() + 7);
  const weekEnd = week.toISOString().slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);
  const { data: todaysPlan = [] } = useQuery({
    queryKey: ["decisions-today"],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase.from("decisions" as never)
        .select("id,recommendation,decision").eq("decided_on", today)
        .order("id", { ascending: true }).limit(12);
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
      const { data } = await supabase.from("decisions" as never)
        .select("id,symbol,action,recommendation,price_at_rec,decided_on")
        .gte("decided_on", cutoff.toISOString().slice(0, 10))
        .not("price_at_rec", "is", null)
        .order("decided_on", { ascending: false }).limit(100);
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
    const econ = liveEcon.filter((e) => e.importance === "high" && e.date >= todayStr && e.date <= weekEnd)
      .map((e) => ({ date: e.date, text: e.name, kind: "econ" as const }));
    const earn = liveEarn.filter((e) => e.date >= todayStr && e.date <= weekEnd)
      .map((e) => ({ date: e.date, text: `${e.symbol} earnings (${e.session === "bmo" ? "pre-market" : "after close"})`, kind: "earnings" as const }));
    const seen = new Set<string>();
    return [...econ, ...earn].sort((a, b) => a.date.localeCompare(b.date))
      .filter((a) => { const k = a.text; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
  }, [liveEcon, liveEarn, todayStr, weekEnd]);
  const cash = Number(selectedAccount?.cash ?? account?.cash ?? 0);
  const marginUsed = Number(selectedAccount?.margin_used ?? 0);
  // Net account value (what Fidelity shows as account value): equity, not gross.
  const portfolioValue = positionsValue + cash - marginUsed;
  // Simple "today" P/L proxy: (current - cost) delta. Real intraday requires last-close snapshot.
  const totalPL = positionsValue - costBasisTotal;
  const totalPLPct = costBasisTotal > 0 ? totalPL / costBasisTotal : 0;

  const goalMetrics = useMemo(() => {
    if (!goal) return null;
    const today = new Date();
    const targetDate = new Date(goal.target_date);
    const years = Math.max(yearsBetween(today, targetDate), 0.01);
    const startVal = portfolioValue > 0 ? portfolioValue : goal.starting_value;
    const cagr = requiredCAGRWithContrib(startVal, goal.target_value, years, Number(goal.monthly_contribution ?? 0));
    const prob = probabilityOfReachingTarget(
      startVal,
      goal.target_value,
      years,
      riskToExpectedReturn(goal.risk_preference),
      riskToVol(goal.risk_preference),
    );
    const progress =
      goal.target_value > goal.starting_value
        ? Math.min(
            1,
            Math.max(
              0,
              (portfolioValue - goal.starting_value) /
                (goal.target_value - goal.starting_value),
            ),
          )
        : 0;
    return { years, cagr, prob, progress };
  }, [goal, portfolioValue]);

  const margin = account
    ? marginStatus(account.margin_used, account.margin_limit)
    : "ok";
  const marginTone =
    margin === "high" ? "negative" : margin === "elevated" ? "warning" : "default";

  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 5 ? "Late night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <AppShell
      title={displayName ? `${greeting}, ${displayName}` : greeting}
      subtitle="Investment Office · What changed. What matters. What to do."
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
      <div className="mb-4">
        <WorkflowButtons symbols={holdings.map((h) => h.symbol)} />
      </div>
      {(() => {
        // ── Command-center strip: freshness · margin meter · constitution check ──
        const marginUsed = Number(selectedAccount?.margin_used ?? 0);
        const amirHs = holdings;
        const gross = amirHs.reduce((x, h) => x + h.quantity * px(h), 0) + Number(selectedAccount?.cash ?? 0);
        const net = gross - marginUsed;
        const equityPct = gross > 0 ? net / gross : 1;
        const dailyInterest = (marginUsed * 0.11825) / 365;
        const lastUpdate = amirHs.reduce<string | null>((m, h) => {
          const u = (h as { updated_at?: string }).updated_at ?? null;
          return u && (!m || u > m) ? u : m;
        }, null);
        const staleDays = lastUpdate ? Math.floor((Date.now() - new Date(lastUpdate).getTime()) / 86400000) : null;
        const breaches: string[] = [];
        // IPS-lite (ADR-APP-004): configurable soft/hard position cap + margin cap.
        const posCap = ipsLite.position_cap_pct / 100;
        for (const h of amirHs) {
          const v = h.quantity * px(h);
          if (net > 0 && v / net > posCap)
            breaches.push(
              `${h.symbol} ${fmtPct(v / net)} > ${ipsLite.position_cap_pct}% cap${ipsLite.position_cap_hard ? " (HARD)" : ""}`,
            );
        }
        const marginUtil = net > 0 ? marginUsed / net : 0;
        if (marginUsed > 0 && marginUtil > ipsLite.margin_cap_pct / 100)
          breaches.push(`Margin util ${fmtPct(marginUtil)} > ${ipsLite.margin_cap_pct}% cap`);
        if (marginUsed > 0 && equityPct < 0.5) breaches.push(`Equity ${fmtPct(equityPct)} < 50%`);
        return (
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border bg-card/60 px-4 py-2 text-xs">
            <span className={staleDays != null && staleDays >= 1 ? "font-medium text-amber-500" : "text-muted-foreground"}>
              Positions: {staleDays == null ? "never imported" : staleDays === 0 ? "imported today" : `imported ${staleDays}d ago`}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              Margin {marginUsed > 0 ? `${fmtUSD(marginUsed)} · ~${fmtUSD(dailyInterest, 2)}/day interest · equity ${fmtPct(equityPct)}` : "not set"}
            </span>
            <span className="text-muted-foreground">·</span>
            {breaches.length === 0 ? (
              <span className="text-emerald-500">Constitution: clean</span>
            ) : (
              <span className="font-medium text-red-500">⚠ {breaches.join(" · ")}</span>
            )}
            {(staleDays == null || staleDays >= 1) && (
              <Link to="/settings" className="ml-auto font-medium text-primary hover:underline">Import now →</Link>
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
            let total = 0, totalDay = 0;
            for (const a of accountsList) {
              const { net, day } = statsOf(a);
              total += net; totalDay += day;
              const cat = accountCategory(a.name);
              const g = groups.get(cat) ?? { net: 0, day: 0 };
              g.net += net; g.day += day;
              groups.set(cat, g);
            }
            const Day = ({ v }: { v: number }) => (
              Math.abs(v) < 0.005 ? null : (
                <span className={v >= 0 ? "text-emerald-500" : "text-red-500"}>
                  {" "}{v >= 0 ? "+" : ""}{fmtUSD(v)}
                </span>
              )
            );
            return (
              <>
                <span className="font-medium">
                  Household {fmtUSD(total)}<Day v={totalDay} />
                </span>
                {CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => (
                  <span key={c} className="text-muted-foreground">
                    {c} <span className="tabular-nums text-foreground">{fmtUSD(groups.get(c)!.net)}</span>
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
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Today's Plan — committee Action Sheet</div>
          <ul className="space-y-0.5 text-sm">
            {todaysPlan.map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <span className={d.decision === "pending" ? "text-amber-500" : "text-emerald-500"}>●</span>
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
                    className={z.status === "hit" ? "font-medium text-emerald-500" : "text-muted-foreground"}
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
            <span key={a.text + a.date}
              className={`rounded-full border px-3 py-1 text-xs ${a.kind === "econ" ? "border-warning/40 bg-warning/10" : "border-primary/30 bg-primary/10"}`}>
              <span className="font-medium">{a.date.slice(5)}</span> · {a.text}
            </span>
          ))}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="Total account value"
          value={fmtUSD(portfolioValue)}
          hint={marginUsed > 0 ? `Investments − margin loan ${fmtUSD(marginUsed)}` : "No margin set — click ✎ on the Portfolio's Margin loan card"}
          tone={marginUsed > 0 ? "default" : "warning"}
          icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          label="Investments (long)"
          value={fmtUSD(positionsValue + cash)}
          hint={`${holdings.length} positions${cash > 0 ? ` + cash ${fmtUSD(cash)}` : ""} · Fidelity "Long"`}
          icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          label="Unrealized P/L"
          value={fmtUSD(totalPL)}
          hint={fmtPct(totalPLPct)}
          tone={totalPL >= 0 ? "positive" : "negative"}
          icon={
            totalPL >= 0 ? (
              <TrendingUp className="h-4 w-4 text-success" />
            ) : (
              <TrendingDown className="h-4 w-4 text-destructive" />
            )
          }
        />
        <StatCard
          label="Today's P/L"
          value={dailyPL ? fmtUSD(dailyPL.sum) : "—"}
          hint={dailyPL ? `vs prev close · ${dailyPL.covered}/${dailyPL.total} quoted` : "Awaiting live quotes"}
          tone={dailyPL ? (dailyPL.sum >= 0 ? "positive" : "negative") : "default"}
        />
        <StatCard
          label="Goal progress"
          value={goalMetrics ? fmtPct(goalMetrics.progress) : "—"}
          hint={
            goal
              ? `${fmtUSD(portfolioValue)} → ${fmtUSD(goal.target_value)} by ${goal.target_date}`
              : "Set a goal"
          }
          icon={<TargetIcon className="h-4 w-4 text-primary" />}
        />
        <StatCard
          label="Margin status"
          value={margin === "ok" ? "Healthy" : margin === "elevated" ? "Elevated" : "High"}
          hint={
            account
              ? `${fmtUSD(account.margin_used)} used / ${fmtUSD(account.margin_limit)} limit`
              : "No margin configured"
          }
          tone={marginTone}
          icon={<ShieldAlert className="h-4 w-4" />}
        />
      </div>

      <div className="mt-4">
        <ProgressChart gross={positionsValue + cash} net={portfolioValue} marginUsed={marginUsed} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border bg-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Goal outlook
              </div>
              <div className="mt-1 text-lg font-semibold">
                {goal ? goal.name : "No goal"}
              </div>
            </div>
            <Link
              to="/goals"
              className="text-xs text-primary hover:underline"
            >
              Edit goal →
            </Link>
          </div>
          {goal && goalMetrics ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <div className="text-xs text-muted-foreground">Required CAGR</div>
                <div className="mt-1 text-xl font-semibold tabular">
                  {fmtPct(goalMetrics.cagr)}
                </div>
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
              <div className="sm:col-span-3">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${(goalMetrics.progress * 100).toFixed(1)}%` }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Head to <Link to="/goals" className="text-primary hover:underline">Goals</Link> to set your target.
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
            No actions queued. Save recommendations from ChatGPT via the Prompt Center or add them in Settings.
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
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${meta.className}`}>
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
