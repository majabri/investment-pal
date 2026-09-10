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
import { pctOrUnavailable, usdOrUnavailable } from "@/lib/unavailable";
import { objectiveOf } from "@/lib/objective";
import {
  canSaveVersion,
  conflictExplanation,
  targetLinkage,
  versionChanges,
} from "@/lib/goalVersion";

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
  const { data: goal, update, versions: versionsQuery } = useGoal();
  const versions = versionsQuery.data;

  const [name, setName] = useState("");
  const [starting, setStarting] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [date, setDate] = useState("");
  const [monthly, setMonthly] = useState<number | null>(null);
  const [risk, setRisk] = useState("moderate");
  const [margin, setMargin] = useState("conservative");
  // GOAL-002. Entered as a PERCENTAGE here (12) and stored as a FRACTION
  // (0.12) — the column and the arithmetic both take fractions, and a field
  // that accepts either is a field that will hold both.
  //
  // It lives on the version rather than on `goals`, because it is a way of
  // STATING the goal rather than a second goal: the target value is what the
  // app measures against, and the return is what the holder was thinking in
  // when they set it.
  const [returnPct, setReturnPct] = useState<number | null>(null);
  // Why it changed, in the holder's words. The single most useful column in
  // the version table and the one `goals.updated_at` could never hold.
  const [versionNote, setVersionNote] = useState("");

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

  // Seeded from the most recent version, not from `goals` — the column only
  // exists there. Absent means the holder has never stated a target return,
  // which is not the same as one of zero.
  useEffect(() => {
    const stated = versions?.[0]?.target_return_pct ?? null;
    setReturnPct(stated === null ? null : Number(stated) * 100);
  }, [versions]);

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

  // GOAL-002. What the two target fields, together, amount to — and whether
  // they contradict each other. The baseline is the STARTING VALUE the holder
  // typed, never the broker's equity: those are two different numbers and
  // planning from a blend of them is the failure GOAL-003 names.
  const linkage = useMemo(
    () =>
      targetLinkage({
        baselineType: "manual_plan",
        baselineValue: starting,
        targetDate: date || null,
        targetValue: target,
        targetReturnPct: returnPct === null ? null : returnPct / 100,
        contributionPlan:
          monthly === null ? null : { amountUsd: monthly, cadence: "monthly" as const },
        withdrawalPlan: null,
      }),
    [starting, date, target, returnPct, monthly],
  );
  const conflict = conflictExplanation(linkage, (n) => fmtUSD(n), (n) => fmtPct(n));

  const save = () => {
    if (!goal) return;
    // A conflict is not a warning to click past. Saving one would put two
    // incompatible plans into an immutable row that later decisions cite, and
    // no later reader could tell which had been meant.
    if (!canSaveVersion(linkage)) {
      toast.error("Target value and target return disagree — resolve them before saving.");
      return;
    }
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
        versionNote: versionNote.trim() || undefined,
        // Stored as a FRACTION on the version; the field above is a percentage.
        targetReturnPct: returnPct === null ? null : returnPct / 100,
      },
      {
        onSuccess: (r) => {
          setVersionNote("");
          // Never a silent half-save. The goal changed either way; whether the
          // history recorded it is a separate fact and the holder is told.
          if (r?.versionRecorded) toast.success("Goal updated — version recorded");
          else
            toast.warning(
              "Goal updated, but no version was recorded (goal_versions is not available yet).",
            );
        },
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
              <Label className="text-xs" htmlFor="goal-target-return">
                Target return % a year (optional)
              </Label>
              <Input
                id="goal-target-return"
                type="number"
                step="0.1"
                placeholder="e.g. 12"
                value={returnPct ?? ""}
                onChange={(e) => setReturnPct(e.target.value === "" ? null : +e.target.value)}
              />
              {/* The linkage, stated rather than silently applied. Entering one
                  field implies the other exactly, given the baseline, the
                  horizon and the contributions — so the implication is shown
                  and never written into the other box. */}
              <p className="mt-1 text-[11px] text-muted-foreground">
                {linkage.kind === "value_only" && linkage.impliedReturnPct !== null
                  ? `Your target implies ${fmtPct(linkage.impliedReturnPct)} a year.`
                  : linkage.kind === "return_only" && linkage.impliedTargetValue !== null
                    ? `That return reaches ${fmtUSD(linkage.impliedTargetValue)}.`
                    : linkage.kind === "agree"
                      ? "Target and return agree."
                      : "Leave blank to work from the target value alone."}
              </p>
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs" htmlFor="goal-version-note">
                Why is this changing? (recorded with the version)
              </Label>
              <Input
                id="goal-version-note"
                value={versionNote}
                onChange={(e) => setVersionNote(e.target.value)}
                placeholder="e.g. moved the date out after the March drawdown"
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
          {/* GOAL-002: the refusal. Both figures are shown with what each one
              actually means, and no winner is picked — choosing silently would
              decide which plan the holder meant. */}
          {conflict !== null && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            >
              {conflict}
            </p>
          )}
          <Button className="mt-4" onClick={save} disabled={conflict !== null}>
            <Save className="mr-2 h-4 w-4" /> Save
          </Button>
          {conflict !== null && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Clear one of the two fields, or change it so they describe the same plan.
            </p>
          )}
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
                : // `progress` is null when the objective's span is not positive —
                  // a target at or below the starting value. That is unknown
                  // progress, not no-scope, and it is a separate absence from
                  // `metrics` being null (no objective at all).
                  `${scopeName} · progress ${
                    metrics ? pctOrUnavailable(metrics.progress) : "objective not set"
                  }`
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

      {/* GOAL-001. What the goal USED to be, and why it changed.
          `goals.updated_at` recorded that something changed and never what, so
          a goal moved to meet the portfolio looked exactly like a portfolio
          moved to meet the goal — and only the second is worth doing. */}
      <div className="mt-4 rounded-2xl border bg-card p-5">
        <div className="mb-1 text-sm font-medium">Goal history</div>
        <p className="mb-3 text-xs text-muted-foreground">
          Every save appends a version and nothing is ever edited. Each decision records the version
          it was taken under.
        </p>
        {versions === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : versions.length === 0 ? (
          // Not "no changes". Nobody has saved the goal since versioning
          // existed, which is a different fact and the one that is true today.
          <p className="text-sm text-muted-foreground">
            No versions recorded yet — the history starts at the next save.
          </p>
        ) : (
          <ol className="space-y-2 text-sm">
            {versions.map((v, i) => {
              // The NEXT entry in a descending list is the older version.
              const older = versions[i + 1] ?? null;
              const changes = versionChanges(older, v, (n) => fmtUSD(n));
              return (
                <li key={v.id} className="border-l-2 border-muted pl-3">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">
                      {usdOrUnavailable(v.target_value === null ? null : Number(v.target_value))}
                      {v.target_date ? ` by ${v.target_date}` : ""}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {v.effective_at.slice(0, 10)} ·{" "}
                      {/* GOAL-003: which kind of starting point this version
                          planned from. A broker-derived baseline and a
                          planning one are different numbers and the version
                          says which it used. */}
                      {v.baseline_type === "broker_equity"
                        ? "from broker equity"
                        : "from a planning baseline"}{" "}
                      {usdOrUnavailable(
                        v.baseline_value === null ? null : Number(v.baseline_value),
                      )}
                    </span>
                  </div>
                  {changes.length > 0 && (
                    <div className="text-[11px] text-muted-foreground">{changes.join(" · ")}</div>
                  )}
                  {v.note && <div className="text-[11px] italic">“{v.note}”</div>}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </AppShell>
  );
}
