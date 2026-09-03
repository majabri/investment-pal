// Portfolio progress over time, for the selected account.
//
// Stage 5 rescoped this. It used to read and write `portfolio_snapshots` with
// `scope = 'amir'` — one hardcoded series for the whole household — so the
// chart kept blending TOD with the IRA, the kids' accounts, the 529s and crypto
// long after Stage 1 stopped every live figure from doing it. Recording now
// lives in `SnapshotRecorder`, so this component only draws.
import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAccountScope } from "@/contexts/AccountContext";
import { useSnapshots, useUnscopedSnapshotCount } from "@/hooks/useAppData";
import { scopeLabel } from "@/lib/accountTotals";
import { balanceSeries, summaryReadiness } from "@/lib/portfolioSummary";
import { fmtUSD } from "@/lib/finance";

export function ProgressChart() {
  const scope = useAccountScope();
  const scopeName = scopeLabel(scope);
  const { data: snapshots = [], isError } = useSnapshots(scope);
  const { data: unscopedCount = 0 } = useUnscopedSnapshotCount();

  const series = useMemo(() => balanceSeries(snapshots), [snapshots]);
  const readiness = summaryReadiness(series);
  const data = useMemo(
    () =>
      series.map((p) => ({
        date: p.date.slice(5),
        Investments: Math.round(p.gross * 100) / 100,
        "Account value": Math.round(p.net * 100) / 100,
      })),
    [series],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Progress over time — {scopeName}</CardTitle>
      </CardHeader>
      <CardContent>
        {isError ? (
          <p className="text-sm text-muted-foreground">
            Snapshot storage isn&apos;t provisioned yet — the portfolio_snapshots migrations need to
            run. Ask Lovable to apply pending migrations, then this chart starts recording
            automatically.
          </p>
        ) : scope.kind !== "account" ? (
          <p className="text-sm text-muted-foreground">
            Select a single account to see its recorded history. A blended series across accounts
            is what this chart used to draw, and it was not a portfolio anyone holds.
          </p>
        ) : !readiness.chartReady ? (
          <p className="text-sm text-muted-foreground">
            {readiness.points === 0
              ? "Recording daily snapshots for this account — the chart draws itself once there are two days of history."
              : "First snapshot captured today. The chart draws once there are two — a single point is a dot, not a trend."}
            {unscopedCount > 0
              ? ` ${unscopedCount} older snapshot${unscopedCount === 1 ? "" : "s"} predate account scoping; they blend every account and cannot be attributed to this one, so they are not charted.`
              : ""}
          </p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
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
                <Area
                  type="monotone"
                  dataKey="Investments"
                  stroke="hsl(var(--muted-foreground))"
                  fill="none"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
                <Area
                  type="monotone"
                  dataKey="Account value"
                  stroke="hsl(var(--primary))"
                  fill="url(#g1)"
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
