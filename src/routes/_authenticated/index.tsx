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
import { StatCard } from "@/components/app/StatCard";
import { ProgressChart } from "@/components/app/ProgressChart";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useGoal,
  useHoldings,
  useAccount,
  useAccounts,
  usePriorities,
  useRecommendedActions,
  useLogSync,
} from "@/hooks/useAppData";
import {
  fmtUSD,
  fmtPct,
  requiredCAGR,
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
  const { data: allHoldings = [] } = useHoldings();
  const { data: accountsList = [] } = useAccounts();
  // The Amir Dashboard tracks the Amir - TOD account only (kids have their own).
  const amirAccount = accountsList.find((a) => a.name === "Amir - TOD");
  const holdings = amirAccount
    ? allHoldings.filter((h) => h.account_id === amirAccount.id)
    : allHoldings.filter((h) => h.account_id == null);
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
  const cash = Number(amirAccount?.cash ?? account?.cash ?? 0);
  const marginUsed = Number(amirAccount?.margin_used ?? 0);
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
    const cagr = requiredCAGR(startVal, goal.target_value, years);
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
      title={`${greeting}, Amir`}
      subtitle="What changed. What matters. What to do."
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
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="Gross value"
          value={fmtUSD(positionsValue + cash)}
          hint={`Positions ${fmtUSD(positionsValue)}${cash > 0 ? ` + cash ${fmtUSD(cash)}` : ""}`}
          icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          label="Net value (equity)"
          value={fmtUSD(portfolioValue)}
          hint={marginUsed > 0 ? `Gross − margin ${fmtUSD(marginUsed)}` : "No margin set — Settings → Amir - TOD"}
          tone={marginUsed > 0 ? "default" : "warning"}
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
