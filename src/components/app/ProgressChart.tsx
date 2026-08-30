// Portfolio progress over time: records one snapshot per day automatically
// (whenever the dashboard is opened) and charts gross vs net.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/supabaseClient";
import { fmtUSD } from "@/lib/finance";

interface Snap { gross: number; net: number; margin_used: number; created_at: string; }

export function ProgressChart({ gross, net, marginUsed }: { gross: number; net: number; marginUsed: number }) {
  const qc = useQueryClient();
  const [unavailable, setUnavailable] = useState(false);

  const { data: snaps = [] } = useQuery({
    queryKey: ["snapshots", "amir"],
    queryFn: async (): Promise<Snap[]> => {
      const { data, error } = await supabase
        .from("portfolio_snapshots" as never)
        .select("gross,net,margin_used,created_at")
        .eq("scope", "amir")
        .order("created_at", { ascending: true })
        .limit(400);
      if (error) { setUnavailable(true); return []; }
      return (data ?? []) as unknown as Snap[];
    },
  });

  // Record at most one snapshot per calendar day, once real values exist.
  useEffect(() => {
    if (unavailable || gross <= 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const last = snaps.at(-1)?.created_at?.slice(0, 10);
    if (last === today) return;
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { error } = await supabase.from("portfolio_snapshots" as never).insert({
        user_id: auth.user.id, scope: "amir", gross, net, margin_used: marginUsed,
      } as never);
      if (!error) void qc.invalidateQueries({ queryKey: ["snapshots", "amir"] });
    })();
  }, [unavailable, gross, net, marginUsed, snaps, qc]);

  const data = useMemo(() =>
    snaps.map((s) => ({
      date: new Date(s.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      "Investments": Math.round(s.gross * 100) / 100,
      "Account value": Math.round(s.net * 100) / 100,
    })), [snaps]);

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Progress over time</CardTitle></CardHeader>
      <CardContent>
        {unavailable ? (
          <p className="text-sm text-muted-foreground">
            Snapshot storage isn&apos;t provisioned yet — the portfolio_snapshots migration needs to run.
            Ask Lovable to apply pending migrations, then this chart starts recording automatically.
          </p>
        ) : data.length < 2 ? (
          <p className="text-sm text-muted-foreground">
            Recording daily snapshots — the chart draws itself once there are at least two days of history.
            {data.length === 1 && " First snapshot captured today."}
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
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`} domain={["auto", "auto"]} />
                <Tooltip formatter={(v: number) => fmtUSD(v)} />
                <Area type="monotone" dataKey="Investments" stroke="hsl(var(--muted-foreground))" fill="none" strokeWidth={1.5} strokeDasharray="4 3" />
                <Area type="monotone" dataKey="Account value" stroke="hsl(var(--primary))" fill="url(#g1)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
