// Goal outlook (audit brief G4).
//
// The rule this panel keeps: a progress bar at 0% is a CLAIM of no progress,
// which is not what "unknown" means. So when progress cannot be computed there
// is no bar at all — not an empty one.
//
// It renders nothing derived: `goalMetrics` is computed in the route from the
// objective and the account value, and is null whenever either is missing.
import { Link } from "@tanstack/react-router";
import { fmtPct } from "@/lib/finance";

/** The projections, or null when the objective or the account value is unknown. */
export type GoalMetrics = {
  cagr: number;
  prob: number;
  years: number;
  /** Fraction of the way from the baseline to the target. NULL = not computable. */
  progress: number | null;
};

export function GoalOutlookPanel({
  goalName,
  metrics,
}: {
  /** NULL = no goal is set at all, which is different from a goal with no metrics. */
  goalName: string | null;
  metrics: GoalMetrics | null;
}) {
  return (
    <section aria-label="Goal outlook" className="rounded-2xl border bg-card p-5 lg:col-span-2">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Goal outlook</h2>
          <div className="mt-1 text-lg font-semibold">{goalName ?? "No goal"}</div>
        </div>
        <Link to="/goals" className="text-xs text-primary hover:underline">
          Edit goal →
        </Link>
      </div>
      {goalName !== null && metrics ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <div className="text-xs text-muted-foreground">Required CAGR</div>
            <div className="mt-1 text-xl font-semibold tabular">{fmtPct(metrics.cagr)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Probability of success</div>
            <div className="mt-1 text-xl font-semibold tabular text-primary">
              {fmtPct(metrics.prob)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Time remaining</div>
            <div className="mt-1 text-xl font-semibold tabular">{metrics.years.toFixed(2)} yrs</div>
          </div>
          {metrics.progress === null ? null : (
            // No bar at all when progress cannot be computed. A bar at 0% is a
            // claim of no progress, which is not what "unknown" means.
            <div className="sm:col-span-3">
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label="Progress toward the target"
                aria-valuenow={Math.round(metrics.progress * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${(metrics.progress * 100).toFixed(1)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Head to{" "}
          <Link to="/goals" className="text-primary hover:underline">
            Goals
          </Link>{" "}
          to set your target.
        </p>
      )}
    </section>
  );
}
