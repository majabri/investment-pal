// Portfolio Summary (Stage 5).
//
// Six panels over ONE account: header, metric row, balance over time,
// performance, asset allocation, portfolio events. Every figure here goes
// through `accountTotals` and `portfolioSummary`, both pure and tested, so this
// route is layout and empty states — which is most of the work, because the
// honest answer on this screen is often "not enough history yet" and that has
// to read as a fact rather than as a flat portfolio.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AppShell } from "@/components/app/AppShell";
import { AccountNotice } from "@/components/app/AccountNotice";
import { ReconciliationBanner } from "@/components/app/ReconciliationBanner";
import { SnapshotRecorder } from "@/components/app/SnapshotRecorder";
import { StatCard } from "@/components/app/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAccountContext, useAccountScope } from "@/contexts/AccountContext";
import {
  useScopedAccount,
  useScopedHoldings,
  useSnapshots,
  useUnscopedSnapshotCount,
} from "@/hooks/useAppData";
import { accountTotals, scopeIsEmpty, scopeLabel, type AccountScope } from "@/lib/accountTotals";
import { getEarningsCalendarFn } from "@/lib/calendarServer";
import { getQuotesFn } from "@/lib/marketServer";
import { fmtPct, fmtUSD } from "@/lib/finance";
import {
  allocation,
  balanceSeries,
  performance,
  summaryMetrics,
  summaryReadiness,
  EVENT_SOURCES,
} from "@/lib/portfolioSummary";

export const Route = createFileRoute("/_authenticated/summary")({
  head: () => ({
    meta: [
      { title: "Portfolio Summary — Investment Companion" },
      { name: "description", content: "Balances, performance, allocation and events for one account." },
    ],
  }),
  component: SummaryPage,
});

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function SummaryPage() {
  const { status: accountStatus } = useAccountContext();
  const selected = useAccountScope();
  // This page is about ONE account, and its title says so. Anything that is
  // not a single account resolves to no scope rather than being allowed to
  // blend: otherwise the metric row would show a household total while the
  // chart and performance panels — which require an account_id — reported no
  // data, and the two halves of the page would be describing different things.
  const scope: AccountScope = selected.kind === "account" ? selected : { kind: "none" };
  const scopeName = scopeLabel(scope);
  const noScope = scopeIsEmpty(scope);

  const { data: holdings } = useScopedHoldings(scope, { includeUnassigned: true });
  const { data: balance } = useScopedAccount(scope);
  const { data: snapshots = [] } = useSnapshots(scope);
  const { data: unscopedCount = 0 } = useUnscopedSnapshotCount();

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

  const series = useMemo(() => balanceSeries(snapshots), [snapshots]);
  const readiness = summaryReadiness(series);
  const perf = useMemo(() => performance(series), [series]);
  const slices = useMemo(() => allocation(holdings, px), [holdings, quotes]);

  const chartData = useMemo(
    () =>
      series.map((p) => ({
        date: p.date.slice(5),
        "Account value": Math.round(p.net * 100) / 100,
        "Gross value": Math.round(p.gross * 100) / 100,
      })),
    [series],
  );

  const heldSymbols = useMemo(() => holdings.map((h) => h.symbol), [holdings]);
  const { data: earnings = [], isLoading: earningsLoading } = useQuery({
    queryKey: ["summary-earnings", heldSymbols.join(",")],
    queryFn: () => getEarningsCalendarFn({ data: { symbols: heldSymbols, days: 30 } }),
    enabled: heldSymbols.length > 0,
    refetchInterval: 60 * 60 * 1000,
  });

  const metrics = summaryMetrics(totals);

  return (
    <AppShell
      title="Portfolio Summary"
      subtitle={`${scopeName} · balances, performance, allocation and what is coming up`}
    >
      <AccountNotice status={accountStatus} />
      {/* One writer for the series, shared with the Morning Brief. Two writers
          with slightly different "already recorded today?" checks is how a
          series acquires duplicate days that then disagree. */}
      <SnapshotRecorder
        gross={totals?.grossValue ?? 0}
        net={totals?.totalAccountValue ?? 0}
        marginUsed={totals?.marginDebit ?? 0}
      />
      <ReconciliationBanner computedTotal={totals?.totalAccountValue ?? 0} />

      {/* ── Metric row ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        {metrics.map((m) => (
          <StatCard
            key={m.label}
            label={m.label}
            value={
              m.value === null
                ? "—"
                : m.kind === "percent"
                  ? fmtPct(m.value)
                  : fmtUSD(m.value)
            }
            hint={scopeName}
          />
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* ── Balance over time ────────────────────────────────────────── */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Balance over time — {scopeName}</CardTitle>
          </CardHeader>
          <CardContent>
            {noScope ? (
              <p className="text-sm text-muted-foreground">
                Select a single account to see its recorded balance history.
              </p>
            ) : !readiness.chartReady ? (
              <p className="text-sm text-muted-foreground">
                {/* An empty chart must not read as a flat portfolio. Say what
                    is missing and when it resolves. */}
                {readiness.points === 0
                  ? "No balance history recorded for this account yet. A snapshot is taken the first time this page is opened each day, and the chart draws once there are two."
                  : "One day recorded so far. The chart draws itself once there are two — a single point is a dot, not a trend."}
                {unscopedCount > 0
                  ? ` ${unscopedCount} older snapshot${unscopedCount === 1 ? "" : "s"} exist from before snapshots were scoped to an account; they are a blend of every account and cannot be attributed to this one, so they are not charted here.`
                  : ""}
              </p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                    <defs>
                      <linearGradient id="summaryFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`}
                      domain={["auto", "auto"]}
                    />
                    <Tooltip formatter={(v: number) => fmtUSD(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area
                      type="monotone"
                      dataKey="Gross value"
                      stroke="hsl(var(--muted-foreground))"
                      fill="none"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                    />
                    <Area
                      type="monotone"
                      dataKey="Account value"
                      stroke="hsl(var(--primary))"
                      fill="url(#summaryFill)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Performance ──────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-xs text-muted-foreground">
              Change in total account value — net of the margin loan, so borrowing to buy does not
              register as a gain.
            </p>
            <dl className="divide-y text-sm">
              {perf.map((p) => (
                <div key={p.label} className="flex items-center justify-between py-1.5">
                  <dt className="text-muted-foreground">
                    {p.label}
                    {/* A window longer than the history is flagged, because
                        "1 month +$2,000" over four days says something else. */}
                    {p.truncated && p.change !== null ? (
                      <span className="ml-1 text-[10px] uppercase text-amber-500">
                        partial history
                      </span>
                    ) : null}
                  </dt>
                  <dd className="tabular text-right">
                    {p.change === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={p.change >= 0 ? "text-success" : "text-destructive"}>
                        {p.change >= 0 ? "+" : ""}
                        {fmtUSD(p.change)}
                        {p.changePct === null ? "" : ` (${fmtPct(p.changePct)})`}
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            {!readiness.performanceReady ? (
              <p className="mt-2 text-xs text-muted-foreground">
                No comparison is possible from a single day of history. These are unknown, not
                zero.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* ── Asset allocation ─────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Asset allocation</CardTitle>
          </CardHeader>
          <CardContent>
            {slices.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {noScope
                  ? "Select a single account to see its allocation."
                  : "No positions in this account to allocate."}
              </p>
            ) : (
              <>
                <div className="h-64">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={slices}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={45}
                        outerRadius={80}
                        paddingAngle={2}
                      >
                        {slices.map((s, i) => (
                          <Cell key={s.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => fmtUSD(v)} />
                      <Legend wrapperStyle={{ fontSize: 11, color: "var(--color-muted-foreground)" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* The shares in text as well as in colour: a doughnut is hard
                    to read precisely, and these are the numbers. */}
                <dl className="mt-2 divide-y text-sm">
                  {slices.map((s) => (
                    <div key={s.name} className="flex items-center justify-between py-1">
                      <dt className="text-muted-foreground">{s.name}</dt>
                      <dd className="tabular">
                        {fmtUSD(s.value)} · {fmtPct(s.share)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </CardContent>
        </Card>

        {/* ── Portfolio events ─────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Portfolio events — next 30 days</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Earnings
              </div>
              {earningsLoading ? (
                <p className="text-sm text-muted-foreground">Loading the earnings calendar…</p>
              ) : heldSymbols.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No positions in this account, so no earnings dates to track.
                </p>
              ) : earnings.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing you hold reports in the next 30 days.
                </p>
              ) : (
                <ul className="divide-y text-sm">
                  {earnings.slice(0, 12).map((e) => (
                    <li key={`${e.symbol}-${e.date}`} className="flex items-center justify-between py-1.5">
                      <span className="font-medium">{e.symbol}</span>
                      <span className="text-muted-foreground">
                        {e.date} · {e.session === "bmo" ? "pre-market" : "after close"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {EVENT_SOURCES.filter((s) => !s.available).map((s) => (
              <div key={s.kind}>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {s.kind === "dividends" ? "Dividends" : s.kind}
                </div>
                {/* Stated, not omitted. A heading with nothing under it invites
                    the reading "no dividends due", which is a claim the app has
                    no basis for. */}
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                  {s.note}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
