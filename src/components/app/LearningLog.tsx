// The learning loop: what the Investment Office recommended, what I did,
// and how it turned out. The mission is improving the process.
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { fmtUSD, fmtPct } from "@/lib/finance";

interface Decision { id: string; review_type: string; symbol: string | null; recommendation: string;
  decision: string; outcome: string | null; outcome_pl: number | null; decided_on: string; }

export function LearningLog() {
  const qc = useQueryClient();
  const [unavailable, setUnavailable] = useState(false);
  const [f, setF] = useState({ symbol: "", recommendation: "", decision: "followed", review_type: "morning" });

  const { data: rows = [] } = useQuery({
    queryKey: ["decisions"],
    queryFn: async (): Promise<Decision[]> => {
      const { data, error } = await supabase.from("decisions" as never)
        .select("*").order("decided_on", { ascending: false }).limit(100);
      if (error) { setUnavailable(true); return []; }
      return (data ?? []) as unknown as Decision[];
    },
  });

  async function add() {
    if (!f.recommendation.trim()) { toast.error("What was recommended?"); return; }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { error } = await supabase.from("decisions" as never).insert({
      user_id: auth.user.id, symbol: f.symbol.toUpperCase() || null,
      recommendation: f.recommendation, decision: f.decision, review_type: f.review_type,
    } as never);
    if (error) { toast.error(error.message); return; }
    setF({ symbol: "", recommendation: "", decision: "followed", review_type: f.review_type });
    void qc.invalidateQueries({ queryKey: ["decisions"] });
  }

  async function setOutcome(id: string, outcome: string, pl: number | null) {
    const { error } = await supabase.from("decisions" as never)
      .update({ outcome, outcome_pl: pl } as never).eq("id", id);
    if (!error) void qc.invalidateQueries({ queryKey: ["decisions"] });
  }

  const since = (days: number) => {
    const d = new Date(); d.setDate(d.getDate() - days);
    const cut = d.toISOString().slice(0, 10);
    return rows.filter((r) => r.decided_on >= cut);
  };
  const scorecard = (set: Decision[]) => {
    const followed = set.filter((r) => r.decision === "followed").length;
    const withOutcome = set.filter((r) => r.outcome_pl != null);
    const wins = withOutcome.filter((r) => (r.outcome_pl ?? 0) > 0).length;
    return {
      n: set.length, followedPct: set.length ? followed / set.length : 0,
      accuracy: withOutcome.length ? wins / withOutcome.length : null,
      pl: withOutcome.reduce((s, r) => s + (r.outcome_pl ?? 0), 0),
    };
  };
  const wk = scorecard(since(7)), mo = scorecard(since(30));

  if (unavailable) {
    return (
      <Card><CardHeader><CardTitle className="text-base">Learning log</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">
          Decision storage isn&apos;t provisioned yet — the decisions migration needs to run (ask Lovable to apply pending migrations).
        </p></CardContent></Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Learning log — recommendation → decision → outcome</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-center sm:grid-cols-2">
          {[["This week", wk], ["This month", mo]].map(([label, s]) => {
            const sc = s as ReturnType<typeof scorecard>;
            return (
              <div key={label as string} className="text-sm">
                <div className="text-xs uppercase text-muted-foreground">{label as string}</div>
                <div className="mt-1">{sc.n} decisions · {fmtPct(sc.followedPct)} followed ·
                  {sc.accuracy == null ? " accuracy —" : ` accuracy ${fmtPct(sc.accuracy)}`} · P/L {fmtUSD(sc.pl)}</div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-24"><Input placeholder="Symbol" value={f.symbol}
            onChange={(e) => setF({ ...f, symbol: e.target.value })} /></div>
          <div className="min-w-48 flex-1"><Input placeholder="Recommendation (e.g. TRIM CRWD to 20%)"
            value={f.recommendation} onChange={(e) => setF({ ...f, recommendation: e.target.value })} /></div>
          <Select value={f.decision} onValueChange={(v) => setF({ ...f, decision: v })}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["followed", "modified", "rejected", "pending"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => void add()}>Log</Button>
        </div>
        <div className="space-y-2">
          {rows.slice(0, 12).map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 border-b pb-2 text-sm last:border-0">
              <span className="w-20 tabular-nums text-muted-foreground">{r.decided_on.slice(5)}</span>
              {r.symbol && <Badge variant="secondary">{r.symbol}</Badge>}
              <span className="min-w-40 flex-1">{r.recommendation}</span>
              <Badge variant={r.decision === "followed" ? "default" : "outline"}>{r.decision}</Badge>
              {r.outcome_pl != null ? (
                <span className={`tabular-nums ${r.outcome_pl >= 0 ? "text-emerald-500" : "text-red-500"}`}>{fmtUSD(r.outcome_pl)}</span>
              ) : (
                <span className="flex items-center gap-1">
                  <Input className="h-7 w-24 text-xs" placeholder="Outcome $"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const v = parseFloat((e.target as HTMLInputElement).value);
                        void setOutcome(r.id, Number.isFinite(v) && v >= 0 ? "win" : "loss", Number.isFinite(v) ? v : null);
                      }
                    }} />
                </span>
              )}
            </div>
          ))}
          {rows.length === 0 && <p className="text-sm text-muted-foreground">Log the first recommendation after your next review.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
