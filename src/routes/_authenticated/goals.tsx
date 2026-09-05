import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app/AppShell";
import { AccountNotice } from "@/components/app/AccountNotice";
import { useAccountContext, useAccountScope } from "@/contexts/AccountContext";
import { StatCard } from "@/components/app/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useGoal, useScopedHoldings, useScopedAccount } from "@/hooks/useAppData";
import { accountTotals, scopeLabel } from "@/lib/accountTotals";
import { useQuery } from "@tanstack/react-query";
import { getQuotesFn } from "@/lib/marketServer";
import {
  fmtPct,
  fmtUSD,
  periodicGrowth,
  probabilityOfReachingTarget,
  requiredCAGR,
  requiredCAGRWithContrib,
  estimatedCompletionDate,
  riskToExpectedReturn,
  riskToVol,
  yearsBetween,
} from "@/lib/finance";
import { usdOrUnavailable } from "@/lib/unavailable";
import { objectiveOf } from "@/lib/objective";

export const Route = createFileRoute("/_authenticated/goals")({
  head: () => ({
    meta: [
      { title: "Goals — Investment Companion" },
      { name: "description", content: "Target value, timeline, and probability of success." },
    ],
  }),
  component: GoalsPage,
});

function GoalsPage() {
  const { data: goal, update } = useGoal();

  const [name, setName] = useState("");
  const [starting, setStarting] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [date, setDate] = useState("");
  const [monthly, setMonthly] = useState<number | null>(null);
  const [risk, setRisk] = useState("moderate");
  const [margin, setMargin] = useState("conservative");

  useEffect(() => {
    if (goal) {
      setName(goal.name);
      // NULL stays null. `Number(null)` is 0, which would show an unset
      // objective as a $0 target and compute against it (rule 13).
      setStarting(goal.starting_value === null ? null : Number(goal.starting_value));
      setTarget(goal.target_value === null ? null : Number(goal.target_value));
      setDate(goal.target_date ?? "");
      setMonthly(goal.monthly_contribution === null ? null : Number(goal.monthly_contribution));
      setRisk(goal.risk_preference);
      setMargin(goal.margin_preference);
    }
  }, [goal]);

  const { status: accountStatus } = useAccountContext();
  // The goal is measured against ONE account's value. It used to read every
  // holding the user owned and fall back to the household's summed cash, so
  // progress towards a single-account target counted the kids' 529s.
  const scope = useAccountScope();
  const { data: holdings } = useScopedHoldings(scope, { includeUnassigned: true });
  const { data: balance } = useScopedAccount(scope);
  const scopeName = scopeLabel(scope);
  const goalSymbols = useMemo(() => [...new Set(holdings.map((h) => h.symbol))], [holdings]);
  const { data: liveQuotes } = useQuery({
    queryKey: ["goal-quotes", goalSymbols.join(",")],
    queryFn: () => getQuotesFn({ data: { symbols: goalSymbols } }),
    enabled: goalSymbols.length > 0,
    refetchInterval: 60 * 1000,
  });
  const portfolioValue = useMemo(
    () =>
      accountTotals(holdings, balance, (h) => liveQuotes?.[h.symbol]?.price ?? h.current_price)
        .totalAccountValue, // net equity — same arithmetic as the Office
    [holdings, balance, liveQuotes],
  );

  const metrics = useMemo(() => {
    // Every figure below needs all three. Computing from two and a default for
    // the third is the fabrication the objective module exists to prevent.
    const objective = objectiveOf({
      starting_value: starting,
      target_value: target,
      target_date: date || null,
      monthly_contribution: monthly,
    });
    // The current value is as load-bearing as the objective: every figure below
    // projects FROM it. `portfolioValue` is null when the account's cash or
    // margin debit is unknown (Phase 1a), and the fallback below would then
    // quietly substitute the objective's own starting value — projecting from
    // the day the goal was written and reporting it as today's pace.
    if (objective.kind !== "set" || portfolioValue === null) return null;
    const years = Math.max(yearsBetween(new Date(), new Date(date)), 0.01);
    const start = portfolioValue > 0 ? portfolioValue : objective.startingValue;
    const cagr = requiredCAGRWithContrib(
      start,
      objective.targetValue,
      years,
      objective.monthlyContribution,
    );
    const weekly = periodicGrowth(start, objective.targetValue, years, 52);
    const monthlyGrowth = periodicGrowth(start, objective.targetValue, years, 12);
    const prob = probabilityOfReachingTarget(
      start,
      objective.targetValue,
      years,
      riskToExpectedReturn(risk),
      riskToVol(risk),
    );
    const span = objective.targetValue - objective.startingValue;
    const progress =
      span > 0 ? Math.max(0, Math.min(1, (portfolioValue - objective.startingValue) / span)) : null;
    const completions = [0.1, 0.15, 0.2].map((r) => ({
      rate: r,
      date: estimatedCompletionDate(start, objective.targetValue, r, objective.monthlyContribution),
    }));
    return { years, cagr, weekly, monthlyGrowth, prob, progress, completions };
  }, [portfolioValue, starting, target, date, monthly, risk]);

  const save = () => {
    if (!goal) return;
    update.mutate(
      {
        id: goal.id,
        name,
        starting_value: starting,
        target_value: target,
        target_date: date || null,
        monthly_contribution: monthly ?? 0,
        risk_preference: risk as "conservative" | "moderate" | "aggressive",
        margin_preference: margin as "none" | "conservative" | "moderate" | "aggressive",
      },
      {
        onSuccess: () => toast.success("Goal updated"),
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  return (
    <AppShell title="Goals" subtitle="Change the goal — everything else recalculates instantly.">
      <AccountNotice status={accountStatus} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border bg-card p-5 lg:col-span-2">
          <div className="mb-4 text-sm font-medium">Primary goal</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Starting value</Label>
              <Input
                type="number"
                value={starting ?? ""}
                onChange={(e) => setStarting(e.target.value === "" ? null : +e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Target value</Label>
              <Input
                type="number"
                value={target ?? ""}
                onChange={(e) => setTarget(e.target.value === "" ? null : +e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Target date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Monthly contribution</Label>
              <Input
                type="number"
                value={monthly ?? ""}
                onChange={(e) => setMonthly(e.target.value === "" ? null : +e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Risk preference</Label>
              <Select value={risk} onValueChange={setRisk}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="conservative">Conservative</SelectItem>
                  <SelectItem value="moderate">Moderate</SelectItem>
                  <SelectItem value="aggressive">Aggressive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Margin preference</Label>
              <Select value={margin} onValueChange={setMargin}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="conservative">Conservative</SelectItem>
                  <SelectItem value="moderate">Moderate</SelectItem>
                  <SelectItem value="aggressive">Aggressive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button className="mt-4" onClick={save}>
            <Save className="mr-2 h-4 w-4" /> Save
          </Button>
        </div>

        <div className="space-y-4">
          {/* Named, because progress towards a target is meaningless without
              knowing which account it is progress in. */}
          <StatCard
            label="Current value"
            value={usdOrUnavailable(portfolioValue)}
            hint={
              portfolioValue === null
                ? `${scopeName} · cash or margin not known`
                : `${scopeName} · progress ${metrics ? fmtPct(metrics.progress) : "—"}`
            }
          />
          <StatCard
            label="Required CAGR"
            value={metrics ? fmtPct(metrics.cagr) : "—"}
            hint={metrics ? `Over ${metrics.years.toFixed(2)} yrs` : ""}
          />
          <StatCard
            label="Probability of success"
            value={metrics ? fmtPct(metrics.prob) : "—"}
            hint={`Assumes ${risk} volatility profile`}
            tone={metrics && metrics.prob >= 0.5 ? "positive" : "warning"}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <StatCard
          label="Weekly growth required"
          value={metrics ? fmtPct(metrics.weekly, 3) : "—"}
        />
        <StatCard
          label="Monthly growth required"
          value={metrics ? fmtPct(metrics.monthlyGrowth, 2) : "—"}
        />
        <StatCard
          label="Time remaining"
          value={metrics ? `${metrics.years.toFixed(2)} yrs` : "—"}
        />
      </div>

      <div className="mt-4 rounded-2xl border bg-card p-5">
        <div className="mb-1 text-sm font-medium">
          Estimated completion — when would you actually get there?
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          At realistic sustained returns (with your monthly contribution), the target date implied
          by the math:
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {metrics?.completions.map((c) => (
            <StatCard
              key={c.rate}
              label={`At ${Math.round(c.rate * 100)}% annual`}
              value={
                c.date
                  ? c.date.toLocaleDateString("en-US", { month: "short", year: "numeric" })
                  : ">40 yrs"
              }
              hint={
                c.date && c.date <= new Date(date)
                  ? "Before your target date"
                  : "After your target date"
              }
              tone={c.date && c.date <= new Date(date) ? "positive" : "warning"}
            />
          ))}
        </div>
      </div>

      {metrics && metrics.prob < 0.6 ? (
        <div className="mt-4 rounded-2xl border border-warning/40 bg-warning/10 p-5">
          <div className="text-sm font-semibold text-warning">Ways to improve probability</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            <li>Extend the target date by 6–12 months to relax required CAGR.</li>
            <li>Increase monthly contributions — even small additions compound the probability.</li>
            <li>
              Reassess risk preference: too conservative for the required return, or too aggressive
              vs your temperament?
            </li>
            <li>Reduce concentration risk in single positions to lower drawdown probability.</li>
          </ul>
        </div>
      ) : null}
    </AppShell>
  );
}
