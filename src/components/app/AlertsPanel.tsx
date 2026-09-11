// Everything wanting attention, in one place (§23.1).
//
// `alerts.ts` aggregated eleven alert types and was imported by no component:
// seven of the conditions were already evaluated somewhere, each visible only
// to whoever happened to be on the screen that rendered it. A margin breach on
// Portfolio, a dead feed in Settings, a stale import on the dashboard strip —
// all real, none gathered.
//
// The rule this surface has to hold hardest is what an EMPTY list means. Empty
// must mean every evaluator ran and found nothing, never that nothing was
// checked. So the panel says which checks it ran, and names the ones it did not
// run here rather than letting their absence read as health.
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { UNBUILT_ALERT_TYPES, alertCounts, raiseAlerts } from "@/lib/alerts";
import type { Alert, AlertInput, AlertSeverity } from "@/lib/alerts";

const ICON: Record<AlertSeverity, typeof ShieldAlert> = {
  critical: ShieldAlert,
  warning: AlertTriangle,
  info: Info,
};

const TONE: Record<AlertSeverity, string> = {
  critical: "text-destructive",
  warning: "text-amber-600 dark:text-amber-400",
  info: "text-muted-foreground",
};

/**
 * What an empty list is entitled to say.
 *
 * Never "all clear" on its own. The sentence names the scope of what ran, so
 * "nothing raised" cannot be read as "nothing can go wrong" — and a reader who
 * knows source health is not probed here is not misled by its silence.
 */
export function emptyStateSentence(checkedConstitution: boolean): string {
  return checkedConstitution
    ? "Every check on this screen ran and raised nothing. Data-source health is checked in Settings."
    : "Policy limits could not be evaluated, so this is not an all-clear.";
}

export function AlertsPanel({
  input,
  /** True when the screen genuinely could not evaluate anything — §23.2's ERROR. */
  failed = false,
}: {
  input: AlertInput;
  failed?: boolean;
}) {
  if (failed) {
    return (
      <section
        aria-label="Alerts"
        role="status"
        className="mb-4 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs"
      >
        <span className="font-medium text-destructive">Alerts could not be evaluated.</span>{" "}
        <span className="text-muted-foreground">
          Nothing here is an all-clear — the check itself failed.
        </span>
      </section>
    );
  }

  const alerts: Alert[] = raiseAlerts(input);
  const counts = alertCounts(alerts);
  const checkedConstitution = input.constitution !== null && input.constitution.checkable;

  return (
    <section aria-label="Alerts" className="mb-4 rounded-xl border bg-card px-4 py-3 text-xs">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Attention</span>
        {alerts.length === 0 ? null : (
          <span className="text-muted-foreground">
            {counts.critical > 0 ? `${counts.critical} critical` : null}
            {counts.critical > 0 && counts.warning > 0 ? " · " : null}
            {counts.warning > 0 ? `${counts.warning} warning` : null}
            {(counts.critical > 0 || counts.warning > 0) && counts.info > 0 ? " · " : null}
            {counts.info > 0 ? `${counts.info} for information` : null}
          </span>
        )}
      </div>

      {alerts.length === 0 ? (
        <p className="text-muted-foreground">{emptyStateSentence(checkedConstitution)}</p>
      ) : (
        <ul className="space-y-1.5">
          {alerts.map((a, i) => {
            const Icon = ICON[a.severity];
            return (
              <li key={`${a.type}-${i}`} className="flex items-start gap-2">
                {/* The icon is not the only carrier of severity — the word is
                    there too (§22.2: no meaning conveyed only by colour). */}
                <Icon className={`mt-0.5 h-3.5 w-3.5 flex-none ${TONE[a.severity]}`} aria-hidden />
                <span>
                  <span className={`font-medium uppercase ${TONE[a.severity]}`}>{a.severity}</span>{" "}
                  <span>{a.message}</span>{" "}
                  <Link to={a.href} className="underline underline-offset-2">
                    Open
                  </Link>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* What this surface cannot raise, named rather than omitted. A list of
          seven that looks like a list of eleven is the same defect as a health
          panel showing four sources of seven. */}
      <details className="mt-2">
        <summary className="cursor-pointer text-muted-foreground">
          Not raised here ({Object.keys(UNBUILT_ALERT_TYPES).length})
        </summary>
        <ul className="mt-1.5 space-y-1 text-muted-foreground">
          {Object.entries(UNBUILT_ALERT_TYPES).map(([type, reason]) => (
            <li key={type}>
              <span className="font-medium">{type.replace(/_/g, " ")}</span> — {reason}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
