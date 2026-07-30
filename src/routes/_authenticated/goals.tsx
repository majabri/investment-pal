import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app/AppShell";
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
import { useGoal, useHoldings, useAccount, useAccounts } from "@/hooks/useAppData";
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
  const { data: holdings = [] } = useHoldings();
  const { data: account } = useAccount();

  const [name, setName] = useState("");
  const [starting, setStarting] = useState(0);
  const [target, setTarget] = useState(0);
  const [date, setDate] = useState("");
  const [monthly, setMonthly] = useState(0);
  const [risk, setRisk] = useState("moderate");
  const [margin, setMargin] = useState("conservative");

  useEffect(() => {
    if (goal) {
      setName(goal.name);
      setStarting(Number(goal.starting_value));
      setTarget(Number(goal.target_value));
      setDate(goal.target_date);
      setMonthly(Number(goal.monthly_contribution));
      setRisk(goal.risk_preference);
      setMargin(goal.margin_preference);
    }
  }, [goal]);

  const { data: accountsList = [] } = useAccounts();
  const amirAccount = accountsList.find((a) => a.name === "Amir - TOD");
  const goalSymbols = useMemo(() => [...new Set(holdings.map((h) => h.symbol))], [holdings]);
  const { data: liveQuotes } = useQuery({
    queryKey: ["goal-quotes", goalSymbols.join(",")],
    queryFn: () => getQuotesFn({ data: { symbols: goalSymbols } }),
    enabled: goalSymbols.length > 0,
    refetchInterval: 60 * 1000,
  });
  const portfolioValue = useMemo(() => {
    const scoped = amirAccount
      ? holdings.filter((h) => h.account_id === amirAccount.id || h.account_id == null)
      : holdings.filter((h) => h.account_id == null);
    const positions = scoped.reduce((s, h) => s + h.quantity * (liveQuotes?.[h.symbol]?.price ?? h.current_price), 0);
    const cash = Number(amirAccount?.cash ?? account?.cash ?? 0);
    const marginUsed = Number(amirAccount?.margin_used ?? 0);
    return positions + cash - marginUsed; // net equity — same base as the Office
  }, [holdings, account, amirAccount, liveQuotes]);

  const metrics = useMemo(() => {
    if (!date) return null;
    const years = Math.max(yearsBetween(new Date(), new Date(date)), 0.01);
    const start = portfolioValue > 0 ? portfolioValue : starting;
    const cagr = requiredCAGRWithContrib(start, target, years, monthly);
    const weekly = periodicGrowth(start, target, years, 52);
    const monthlyGrowth = periodicGrowth(start, target, years, 12);
    const prob = probabilityOfReachingTarget(start, target, years, riskToExpectedReturn(risk), riskToVol(risk));
    const progress =
      target > starting ? Math.max(0, Math.min(1, (portfolioValue - starting) / (target - starting))) : 0;
    const completions = [0.10, 0.15, 0.20].map((r) => ({
      rate: r,
      date: estimatedCompletionDate(start, target, r, monthly),
    }));
    return { years, cagr, weekly, monthlyGrowth, prob, progress, completions };
  }, [portfolioValue, starting, target, date, risk]);

  const save = () => {
    if (!goal) return;
    update.mutate(
      {
        id: goal.id,
        name,
        starting_value: starting,
        target_value: target,
        target_date: date,
        monthly_contribution: monthly,
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
              <Input type="number" value={starting} onChange={(e) => setStarting(+e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Target value</Label>
              <Input type="number" value={target} onChange={(e) => setTarget(+e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Target date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Monthly contribution</Label>
              <Input type="number" value={monthly} onChange={(e) => setMonthly(+e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Risk preference</Label>
              <Select value={risk} onValueChange={setRisk}>
                <SelectTrigger><SelectValue /></SelectTrigger>
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
                <SelectTrigger><SelectValue /></SelectTrigger>
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
          <StatCard
            label="Current value"
            value={fmtUSD(portfolioValue)}
            hint={`Progress ${metrics ? fmtPct(metrics.progress) : "—"}`}
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
        <div className="mb-1 text-sm font-medium">Estimated completion — when would you actually get there?</div>
        <p className="mb-3 text-xs text-muted-foreground">
          At realistic sustained returns (with your monthly contribution), the target date implied by the math:
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {metrics?.completions.map((c) => (
            <StatCard
              key={c.rate}
              label={`At ${Math.round(c.rate * 100)}% annual`}
              value={c.date ? c.date.toLocaleDateString("en-US", { month: "short", year: "numeric" }) : ">40 yrs"}
              hint={c.date && c.date <= new Date(date) ? "Before your target date" : "After your target date"}
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
            <li>Reassess risk preference: too conservative for the required return, or too aggressive vs your temperament?</li>
            <li>Reduce concentration risk in single positions to lower drawdown probability.</li>
          </ul>
        </div>
      ) : null}
    </AppShell>
  );
}
