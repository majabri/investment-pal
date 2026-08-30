// The learning loop: what the Investment Office recommended, what I did, and how
// it turned out. Outcomes are auto-graded at 1d/1w/1m from price_history vs the
// price at recommendation time (ADR-APP-001 item 3, src/lib/outcomeGrade.ts) —
// measurement only, no sizing/orders. Manual P/L logging is still available.
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabaseClient";
import { fmtUSD, fmtPct } from "@/lib/finance";
import { getQuotesFn } from "@/lib/marketServer";
import { computeOutcome, type Grade, type Close } from "@/lib/outcomeGrade";

interface Decision {
  id: string;
  review_type: string;
  symbol: string | null;
  recommendation: string;
  decision: string;
  outcome: string | null;
  outcome_pl: number | null;
  decided_on: string;
  action: string | null;
  price_at_rec: number | null;
  outcome_1d: number | null;
  outcome_1w: number | null;
  outcome_1m: number | null;
  grade: Grade | null;
}

const round4 = (n: number | null): number | null => (n == null ? null : Math.round(n * 1e4) / 1e4);

const GRADE_STYLE: Record<
  Grade,
  { variant: "default" | "secondary" | "outline" | "destructive"; label: string }
> = {
  CORRECT: { variant: "default", label: "✓ correct" },
  WRONG: { variant: "destructive", label: "✗ wrong" },
  NEUTRAL: { variant: "secondary", label: "~ neutral" },
  PENDING: { variant: "outline", label: "pending" },
};

export function LearningLog() {
  const qc = useQueryClient();
  const [unavailable, setUnavailable] = useState(false);
  const [f, setF] = useState({
    symbol: "",
    recommendation: "",
    decision: "followed",
    review_type: "morning",
  });

  const { data: rows = [] } = useQuery({
    queryKey: ["decisions"],
    queryFn: async (): Promise<Decision[]> => {
      const { data, error } = await supabase
        .from("decisions" as never)
        .select("*")
        .order("decided_on", { ascending: false })
        .limit(100);
      if (error) {
        setUnavailable(true);
        return [];
      }
      return (data ?? []) as unknown as Decision[];
    },
  });

  // Daily closes for grading the logged decisions.
  const gradeSymbols = Array.from(
    new Set(rows.filter((r) => r.symbol && r.price_at_rec != null).map((r) => r.symbol as string)),
  );
  const gradeKey = gradeSymbols.join(",");
  const { data: gradeHistory = [] } = useQuery({
    queryKey: ["decisions-price-history", gradeKey],
    enabled: gradeSymbols.length > 0,
    queryFn: async (): Promise<{ symbol: string; date: string; close: number }[]> => {
      const { data } = await supabase
        .from("price_history" as never)
        .select("symbol,date,close")
        .in("symbol", gradeSymbols)
        .order("date", { ascending: true });
      return (data ?? []) as unknown as { symbol: string; date: string; close: number }[];
    },
  });

  // Refresh-time grading: compute & persist grades for decisions whose stored
  // values are stale. Terminates because we store rounded values, so on the next
  // pass computed === stored and nothing is written.
  const gradingRef = useRef(false);
  useEffect(() => {
    if (gradingRef.current || rows.length === 0) return;
    const bySym = new Map<string, Close[]>();
    for (const h of gradeHistory) {
      const arr = bySym.get(h.symbol) ?? [];
      arr.push({ date: h.date, close: Number(h.close) });
      bySym.set(h.symbol, arr);
    }
    const updates: {
      id: string;
      outcome_1d: number | null;
      outcome_1w: number | null;
      outcome_1m: number | null;
      grade: Grade;
    }[] = [];
    for (const r of rows) {
      if (!r.symbol || r.price_at_rec == null) continue;
      const res = computeOutcome({
        decidedOn: r.decided_on,
        priceAtRec: Number(r.price_at_rec),
        action: r.action,
        recommendation: r.recommendation,
        closes: bySym.get(r.symbol) ?? [],
      });
      const o1d = round4(res.outcome_1d);
      const o1w = round4(res.outcome_1w);
      const o1m = round4(res.outcome_1m);
      const changed =
        res.grade !== (r.grade ?? null) ||
        o1d !== round4(r.outcome_1d) ||
        o1w !== round4(r.outcome_1w) ||
        o1m !== round4(r.outcome_1m);
      if (changed)
        updates.push({
          id: r.id,
          outcome_1d: o1d,
          outcome_1w: o1w,
          outcome_1m: o1m,
          grade: res.grade,
        });
    }
    if (updates.length === 0) return;
    gradingRef.current = true;
    void (async () => {
      for (const u of updates) {
        await supabase
          .from("decisions" as never)
          .update({
            outcome_1d: u.outcome_1d,
            outcome_1w: u.outcome_1w,
            outcome_1m: u.outcome_1m,
            grade: u.grade,
          } as never)
          .eq("id", u.id);
      }
      gradingRef.current = false;
      void qc.invalidateQueries({ queryKey: ["decisions"] });
    })();
  }, [rows, gradeHistory, qc]);

  async function add() {
    if (!f.recommendation.trim()) {
      toast.error("What was recommended?");
      return;
    }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const sym = f.symbol.toUpperCase() || null;
    // Anchor the live price so this decision can be graded later.
    let priceAtRec: number | null = null;
    if (sym) {
      try {
        const q = await getQuotesFn({ data: { symbols: [sym] } });
        priceAtRec = q[sym]?.price ?? null;
      } catch {
        priceAtRec = null;
      }
    }
    const { error } = await supabase.from("decisions" as never).insert({
      user_id: auth.user.id,
      symbol: sym,
      recommendation: f.recommendation,
      decision: f.decision,
      review_type: f.review_type,
      price_at_rec: priceAtRec,
    } as never);
    if (error) {
      toast.error(error.message);
      return;
    }
    setF({ symbol: "", recommendation: "", decision: "followed", review_type: f.review_type });
    void qc.invalidateQueries({ queryKey: ["decisions"] });
  }

  async function setOutcome(id: string, outcome: string, pl: number | null) {
    const { error } = await supabase
      .from("decisions" as never)
      .update({ outcome, outcome_pl: pl } as never)
      .eq("id", id);
    if (!error) void qc.invalidateQueries({ queryKey: ["decisions"] });
  }

  const since = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    const cut = d.toISOString().slice(0, 10);
    return rows.filter((r) => r.decided_on >= cut);
  };
  const scorecard = (set: Decision[]) => {
    const followed = set.filter((r) => r.decision === "followed").length;
    const graded = set.filter((r) => r.grade === "CORRECT" || r.grade === "WRONG");
    const correct = set.filter((r) => r.grade === "CORRECT").length;
    const withPl = set.filter((r) => r.outcome_pl != null);
    return {
      n: set.length,
      followedPct: set.length ? followed / set.length : 0,
      accuracy: graded.length ? correct / graded.length : null,
      gradedN: graded.length,
      pl: withPl.reduce((s, r) => s + (r.outcome_pl ?? 0), 0),
    };
  };
  const wk = scorecard(since(7));
  const mo = scorecard(since(30));

  if (unavailable) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Learning log</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Decision storage isn&apos;t provisioned yet — the decisions migration needs to run (ask
            Lovable to apply pending migrations).
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Learning log — recommendation → decision → graded outcome
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-center sm:grid-cols-2">
          {[
            ["This week", wk],
            ["This month", mo],
          ].map(([label, s]) => {
            const sc = s as ReturnType<typeof scorecard>;
            return (
              <div key={label as string} className="text-sm">
                <div className="text-xs uppercase text-muted-foreground">{label as string}</div>
                <div className="mt-1">
                  {sc.n} decisions · {fmtPct(sc.followedPct)} followed ·{" "}
                  {sc.accuracy == null
                    ? "accuracy —"
                    : `accuracy ${fmtPct(sc.accuracy)} (${sc.gradedN} graded)`}{" "}
                  · P/L {fmtUSD(sc.pl)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-24">
            <Input
              placeholder="Symbol"
              value={f.symbol}
              onChange={(e) => setF({ ...f, symbol: e.target.value })}
            />
          </div>
          <div className="min-w-48 flex-1">
            <Input
              placeholder="Recommendation (e.g. TRIM CRWD to 20%)"
              value={f.recommendation}
              onChange={(e) => setF({ ...f, recommendation: e.target.value })}
            />
          </div>
          <Select value={f.decision} onValueChange={(v) => setF({ ...f, decision: v })}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["followed", "modified", "rejected", "pending"].map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => void add()}>Log</Button>
        </div>
        <div className="space-y-2">
          {rows.slice(0, 12).map((r) => {
            const g = r.grade ? GRADE_STYLE[r.grade] : null;
            return (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-2 border-b pb-2 text-sm last:border-0"
              >
                <span className="w-20 tabular-nums text-muted-foreground">
                  {r.decided_on.slice(5)}
                </span>
                {r.symbol && <Badge variant="secondary">{r.symbol}</Badge>}
                <span className="min-w-40 flex-1">{r.recommendation}</span>
                <Badge variant={r.decision === "followed" ? "default" : "outline"}>
                  {r.decision}
                </Badge>
                {g && (
                  <Badge
                    variant={g.variant}
                    title={
                      r.price_at_rec != null
                        ? `graded vs price at rec ${fmtUSD(Number(r.price_at_rec), 2)} · ` +
                          `1m ${r.outcome_1m != null ? fmtPct(r.outcome_1m) : "—"} · ` +
                          `1w ${r.outcome_1w != null ? fmtPct(r.outcome_1w) : "—"} · ` +
                          `1d ${r.outcome_1d != null ? fmtPct(r.outcome_1d) : "—"}`
                        : "no price anchor"
                    }
                  >
                    {g.label}
                    {r.outcome_1m != null &&
                      ` ${r.outcome_1m >= 0 ? "+" : ""}${fmtPct(r.outcome_1m)}`}
                  </Badge>
                )}
                {r.outcome_pl != null ? (
                  <span
                    className={`tabular-nums ${r.outcome_pl >= 0 ? "text-emerald-500" : "text-red-500"}`}
                  >
                    {fmtUSD(r.outcome_pl)}
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <Input
                      className="h-7 w-24 text-xs"
                      placeholder="Outcome $"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const v = parseFloat((e.target as HTMLInputElement).value);
                          void setOutcome(
                            r.id,
                            Number.isFinite(v) && v >= 0 ? "win" : "loss",
                            Number.isFinite(v) ? v : null,
                          );
                        }
                      }}
                    />
                  </span>
                )}
              </div>
            );
          })}
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Log the first recommendation after your next review.
            </p>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Grades are auto-computed from price_history: direction-aware (BUY/ADD expect up; SELL/TRIM
          expect down), on the 1-month move (falling back to 1-week), with a ±2% dead-band →
          neutral. Measurement only.
        </p>
      </CardContent>
    </Card>
  );
}
