// The Portfolio Summary panels (Stage 5b).
//
// Extracted so the Morning Brief and the dedicated Summary page render the SAME
// panels rather than two drifting approximations of them. The brief's layout is
// modelled on Fidelity's Portfolio Summary; the panels below are its rows.
//
// Every panel here obeys one rule, inherited from Stage 1 and repeated because
// it is the whole point of the screen: a figure with no basis renders as an em
// dash and says why. Never 0, never 0.00%, never a bar at zero. On a screen
// used for real money decisions, a confident wrong number costs more than a
// blank one.
import { useState } from "react";
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

import { StatCard } from "@/components/app/StatCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { AccountTotals, AccountScope } from "@/lib/accountTotals";
import { scopeLabel } from "@/lib/accountTotals";
import { fmtPct, fmtUSD } from "@/lib/finance";
import { interestProvenanceShort, marginRateLabel, type InterestFigure } from "@/lib/marginCost";
import {
  allocation,
  goalProgress,
  performance,
  seriesInRange,
  summaryMetrics,
  summaryReadiness,
  CHART_RANGES,
  EVENT_SOURCES,
  type AllocatablePosition,
  type BalancePoint,
  type ChartRange,
  type DayChange,
} from "@/lib/portfolioSummary";
import type { MarginPolicy } from "@/lib/marginCost";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/** Colour carries meaning about money only — never about UI state. */
const moneyTone = (n: number) => (n >= 0 ? "text-success" : "text-destructive");

// ── Header ───────────────────────────────────────────────────────────────────

export function SummaryHeader({
  scope,
  totals,
  day,
}: {
  scope: AccountScope;
  totals: AccountTotals | null;
  day: DayChange;
}) {
  const name = scopeLabel(scope);
  return (
    <div className="mb-4 rounded-2xl border bg-card p-5">
      <div className="text-sm text-muted-foreground">{name}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="text-3xl font-semibold tabular">
          {totals === null ? "—" : fmtUSD(totals.totalAccountValue)}
        </span>
        <span className="text-sm">
          <span className="text-muted-foreground">Today </span>
          {day === null ? (
            // Not zero. "The market data has not arrived" and "the account did
            // not move" are different facts.
            <span className="text-muted-foreground">— awaiting live quotes</span>
          ) : (
            <span className={`tabular ${moneyTone(day.amount)}`}>
              {day.amount >= 0 ? "+" : ""}
              {fmtUSD(day.amount)}
              {day.covered < day.total ? (
                // A day change over 3 of 11 holdings is not the account's day
                // change, and saying so is cheaper than being quietly wrong.
                <span className="ml-1 text-[11px] text-muted-foreground">
                  ({day.covered}/{day.total} quoted)
                </span>
              ) : null}
            </span>
          )}
        </span>
        <span className="text-sm">
          <span className="text-muted-foreground">Equity </span>
          <span className="tabular">
            {totals?.equityPct == null ? "—" : fmtPct(totals.equityPct)}
          </span>
        </span>
      </div>
    </div>
  );
}

// ── Metric row ───────────────────────────────────────────────────────────────

export function SummaryMetricRow({
  scope,
  totals,
  interest,
  policy,
}: {
  scope: AccountScope;
  totals: AccountTotals | null;
  interest: InterestFigure;
  policy: MarginPolicy;
}) {
  const name = scopeLabel(scope);
  const metrics = summaryMetrics(totals);
  return (
    <div className="grid gap-4 md:grid-cols-4 xl:grid-cols-8">
      {metrics.map((m) => (
        <StatCard
          key={m.label}
          label={m.label}
          value={
            m.value === null ? "—" : m.kind === "percent" ? fmtPct(m.value) : fmtUSD(m.value)
          }
          hint={name}
        />
      ))}
      {/* Interest accrued this month — the broker's figure where an import
          supplied one, the app's estimate otherwise, always labelled. */}
      <StatCard
        label="Interest this month"
        value={
          interest.kind === "actual"
            ? fmtUSD(interest.accruedMtd, 2)
            : interest.kind === "estimate"
              ? `~${fmtUSD(interest.daily * 30, 2)}`
              : "—"
        }
        hint={interestProvenanceShort(interest)}
      />
      {/* The rate with its as-of date. `marginRateLabel` is the one place that
          renders it, so no screen can quietly drop the staleness. */}
      <StatCard
        label="Margin rate"
        value={policy.margin_rate_annual_pct == null ? "—" : `${policy.margin_rate_annual_pct}%`}
        hint={marginRateLabel(policy)}
      />
    </div>
  );
}

// ── Balance over time ────────────────────────────────────────────────────────

export function BalanceOverTime({
  scope,
  series,
  unscopedCount,
  isError,
}: {
  scope: AccountScope;
  series: BalancePoint[];
  unscopedCount: number;
  isError?: boolean;
}) {
  const [range, setRange] = useState<ChartRange>(CHART_RANGES[CHART_RANGES.length - 1]);
  const shown = seriesInRange(series, range);
  const readiness = summaryReadiness(shown);
  const data = shown.map((p) => ({
    date: p.date.slice(5),
    "Account value": Math.round(p.net * 100) / 100,
    "Gross value": Math.round(p.gross * 100) / 100,
  }));

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Balance over time — {scopeLabel(scope)}</CardTitle>
        <div className="flex gap-1">
          {CHART_RANGES.map((r) => (
            <Button
              key={r.label}
              size="sm"
              variant={r.label === range.label ? "secondary" : "ghost"}
              className="h-7 px-2 text-xs"
              onClick={() => setRange(r)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isError ? (
          // Deliberately does not assert WHY. `isError` covers a missing table,
          // a network failure and an RLS refusal alike, and naming one of them
          // sends the reader to fix something that may not be broken. Say what
          // is true — the history could not be read — and offer the likeliest
          // cause as a possibility rather than a diagnosis.
          <p className="text-sm text-muted-foreground">
            Could not read the balance history for this account. If the
            portfolio_snapshots migrations have not been applied yet, that is the likeliest
            cause — ask Lovable to apply pending migrations. Otherwise this is a connection or
            permissions problem, and the figures above are unaffected.
          </p>
        ) : scope.kind !== "account" ? (
          <p className="text-sm text-muted-foreground">
            Select a single account to see its recorded history. A blended series across accounts
            is what this chart used to draw, and it was not a portfolio anyone holds.
          </p>
        ) : !readiness.chartReady ? (
          <p className="text-sm text-muted-foreground">
            {series.length === 0
              ? "No balance history recorded for this account yet. A snapshot is taken the first time this page is opened each day, and the chart draws once there are two."
              : shown.length < series.length || series.length === 1
                ? `Only ${shown.length} point${shown.length === 1 ? "" : "s"} in this range. Widen the range, or wait — the chart draws once a range holds two.`
                : "One day recorded so far. The chart draws itself once there are two — a single point is a dot, not a trend."}
            {unscopedCount > 0
              ? ` ${unscopedCount} older snapshot${unscopedCount === 1 ? "" : "s"} predate account scoping; they blend every account and cannot be attributed to this one, so they are not charted.`
              : ""}
          </p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <defs>
                  {/* Bare `var(--primary)`, NOT `hsl(var(--primary))`.
                      This theme defines --primary as a complete oklch() colour,
                      so wrapping it produced `hsl(oklch(...))` — an invalid
                      colour the browser silently drops. The result was a chart
                      with axes and no visible line: it looked like an empty
                      series rather than a broken style, which is why it went
                      unnoticed. The doughnut never had the bug because it uses
                      bare var(--chart-N). */}
                  <linearGradient id="summaryFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
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
                  stroke="var(--muted-foreground)"
                  fill="none"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
                <Area
                  type="monotone"
                  dataKey="Account value"
                  stroke="var(--primary)"
                  fill="url(#summaryFill)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Performance ──────────────────────────────────────────────────────────────

export function PerformancePanel({
  series,
  totals,
  objective,
}: {
  series: BalancePoint[];
  totals: AccountTotals | null;
  objective: { starting_value: number; target_value: number; target_date: string } | null;
}) {
  const entries = performance(series);
  const readiness = summaryReadiness(series);
  const progress = goalProgress(totals?.totalAccountValue ?? null, objective);

  return (
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
          {entries.map((p) => (
            <div key={p.label} className="flex items-center justify-between py-1.5">
              <dt className="text-muted-foreground">
                {p.label}
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
                  <span className={moneyTone(p.change)}>
                    {p.change >= 0 ? "+" : ""}
                    {fmtUSD(p.change)}
                    {p.changePct === null ? "" : ` (${fmtPct(p.changePct)})`}
                  </span>
                )}
              </dd>
            </div>
          ))}
          <div className="flex items-center justify-between py-1.5">
            <dt className="text-muted-foreground">Unrealized P/L</dt>
            <dd className="tabular text-right">
              {totals === null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <span className={moneyTone(totals.unrealizedPL)}>
                  {totals.unrealizedPL >= 0 ? "+" : ""}
                  {fmtUSD(totals.unrealizedPL)}
                  {totals.unrealizedPLPct === null ? "" : ` (${fmtPct(totals.unrealizedPLPct)})`}
                </span>
              )}
            </dd>
          </div>
        </dl>

        {/* Progress against the one objective (Stage 4's goal row), never a
            literal. A bar at 0% would claim no progress; no objective means
            there is nothing to measure against, and that is what it says. */}
        <div className="mt-3 border-t pt-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Progress to objective</span>
            <span className="tabular">{progress === null ? "—" : fmtPct(progress)}</span>
          </div>
          {progress === null ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {objective
                ? "The objective's target is not above its starting value, so there is no span to measure progress along."
                : "No objective set. Set a target value and date in Settings."}
            </p>
          ) : (
            <>
              <Progress value={progress * 100} className="mt-2" />
              <p className="mt-1 text-xs text-muted-foreground">
                {fmtUSD(objective!.starting_value)} → {fmtUSD(objective!.target_value)} by{" "}
                {objective!.target_date}
              </p>
            </>
          )}
        </div>

        {!readiness.performanceReady ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No comparison is possible from a single day of history. The windows above are unknown,
            not zero.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ── Asset allocation ─────────────────────────────────────────────────────────

export function AllocationPanel<T extends AllocatablePosition>({
  positions,
  priceOf,
  noScope,
}: {
  positions: readonly T[];
  priceOf?: (p: T) => number;
  noScope: boolean;
}) {
  const slices = allocation(positions, priceOf);
  return (
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
            {/* The shares in text as well as in colour: a doughnut is hard to
                read precisely, and these are the numbers. */}
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
  );
}

// ── Portfolio events ─────────────────────────────────────────────────────────

export function EventsPanel({
  earnings,
  isLoading,
  heldCount,
}: {
  earnings: { symbol: string; date: string; session: string }[];
  isLoading: boolean;
  heldCount: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Portfolio events — next 30 days</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Earnings
          </div>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading the earnings calendar…</p>
          ) : heldCount === 0 ? (
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
            {/* Stated, not omitted. A heading with nothing under it invites the
                reading "no dividends due", which the app has no basis for. */}
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              {s.note}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
