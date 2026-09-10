// The alert types the blueprint names (§23.1), from evaluators that exist.
//
// The audit recorded "Alerts / notifications (§23) — No table, no service, not
// built". True of the *service*; less true of the *conditions*. Most of §23.1's
// eleven types are already computed somewhere in this app and rendered on one
// screen each:
//
//   data source failure       → `sourceHealth.ts`      (Settings)
//   stale quote               → `freshness.ts`         (per figure)
//   missing valuation         → `accountTotals`        (per figure)
//   earnings/event proximity  → the dashboard's chips
//   goal pace deterioration   → `goalMetrics`          (dashboard)
//   risk/concentration breach → `constitutionCheck.ts` (dashboard strip)
//   margin threshold          → `constitutionCheck.ts` (dashboard strip)
//
// So what is missing is not a computation. It is that no ONE place answers
// "what needs my attention?", and each condition is only visible to somebody
// already on the screen that renders it.
//
// This module is that one place: a typed aggregation over evaluators that
// already run. It deliberately adds NO table.
//
// WHAT IS NOT BUILT, AND WHY
//
//   * PERSISTENCE — acknowledging an alert so it stops nagging needs a table.
//     Three migrations already wait on Lovable; a fourth to hold dismissal
//     state, for a surface nobody has used yet, is the wrong order.
//   * DELIVERY — push, email, SMS. The app has no delivery channel, and adding
//     one is a secrets and scope question (OD-002, CLAUDE.md), not a coding
//     one.
//   * The four remaining §23.1 types — decision trigger reached, invalidation
//     reached, order/fill reconciliation needed, model health/calibration —
//     are declared in `UNBUILT_ALERT_TYPES` below rather than omitted, so the
//     gap is visible in the code rather than only in an audit.
import type { ConstitutionVerdict } from "./constitutionCheck";
import type { SourceHealth } from "./sourceHealth";

/** Every alert type §23.1 names. The full list, built or not. */
export const ALERT_TYPES = [
  "data_source_failure",
  "stale_quote",
  "missing_valuation",
  "event_proximity",
  "goal_pace",
  "concentration_breach",
  "margin_threshold",
  "decision_trigger",
  "invalidation_reached",
  "reconciliation_needed",
  "model_health",
] as const;

export type AlertType = (typeof ALERT_TYPES)[number];

/**
 * The types this module cannot yet raise, and why.
 *
 * Declared rather than omitted. A list of seven that looks like a list of
 * eleven is the same defect as a health panel showing four sources of seven —
 * complete-looking and quietly partial.
 */
export const UNBUILT_ALERT_TYPES: Record<string, string> = {
  decision_trigger: "No stored trigger conditions to evaluate against.",
  invalidation_reached: "Invalidation conditions are recorded on decisions but not evaluated.",
  reconciliation_needed: "Reconciliation runs on the Portfolio page but raises no standing alert.",
  model_health: "No backtest or calibration exists to be healthy or unhealthy (deferred, §4).",
};

/** How much attention it wants. Not a colour — a rank. */
export type AlertSeverity = "critical" | "warning" | "info";

export type Alert = {
  type: AlertType;
  severity: AlertSeverity;
  /** One line, in the user's terms. */
  message: string;
  /** Where to go and do something about it. */
  href: string;
};

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** What the aggregator reads. Everything here is computed elsewhere already. */
export type AlertInput = {
  constitution: ConstitutionVerdict | null;
  sources: readonly SourceHealth[];
  /** Whole days since the newest position import. NULL = never imported. */
  positionsStaleDays: number | null;
  /** True when the account value could not be computed at all. */
  valuationUnknown: boolean;
  /** Probability of reaching the goal, or NULL when it cannot be computed. */
  goalProbability: number | null;
  /** Events inside the alerting window, already filtered by the caller. */
  upcomingEvents: readonly { date: string; text: string }[];
};

/** Below this, the goal is off pace enough to say so. */
export const GOAL_PACE_FLOOR = 0.5;
/** Positions older than this are stale enough to raise. */
export const POSITIONS_STALE_DAYS = 2;

/**
 * Everything wanting attention, worst first.
 *
 * Pure, so the rules are assertable without a database, a clock or a network.
 * An empty list means every evaluator ran and found nothing — NOT that nothing
 * was checked. The caller distinguishes those; `AlertInput` carries nulls for
 * the things that could not be evaluated, and each of those raises its own
 * alert rather than silently contributing nothing.
 */
export function raiseAlerts(input: AlertInput): Alert[] {
  const out: Alert[] = [];

  // A check that could not run is itself the alert. This is the one that would
  // otherwise be silent: no breaches, because nothing was evaluated.
  if (input.constitution && !input.constitution.checkable) {
    out.push({
      type: "missing_valuation",
      severity: "critical",
      message:
        "Policy limits were not checked — the account value is unknown. This is not a clean result.",
      href: "/settings",
    });
  } else if (input.constitution) {
    for (const breach of input.constitution.breaches) {
      out.push({
        type: breach.startsWith("Margin util") ? "margin_threshold" : "concentration_breach",
        severity: "critical",
        message: breach,
        href: "/portfolio",
      });
    }
  }

  if (input.valuationUnknown) {
    out.push({
      type: "missing_valuation",
      severity: "critical",
      message: "The account value could not be computed. Figures that depend on it are unknown.",
      href: "/settings",
    });
  }

  for (const s of input.sources) {
    if (s.coverage === "UNAVAILABLE") {
      out.push({
        type: "data_source_failure",
        severity: "warning",
        message: `${s.descriptor.label} did not answer. ${s.descriptor.impact}`,
        href: "/settings",
      });
    }
  }

  // NULL is "never imported", which is worse than stale, not better.
  if (input.positionsStaleDays === null) {
    out.push({
      type: "stale_quote",
      severity: "warning",
      message: "Positions have never been imported.",
      href: "/settings",
    });
  } else if (input.positionsStaleDays >= POSITIONS_STALE_DAYS) {
    out.push({
      type: "stale_quote",
      severity: "warning",
      message: `Positions were last imported ${input.positionsStaleDays} days ago.`,
      href: "/settings",
    });
  }

  // An uncomputable probability is not a low one, and must not be alerted as
  // though the goal were off pace — that would be a claim about the plan.
  if (input.goalProbability !== null && input.goalProbability < GOAL_PACE_FLOOR) {
    out.push({
      type: "goal_pace",
      severity: "warning",
      message: `Probability of reaching the goal is ${(input.goalProbability * 100).toFixed(0)}%.`,
      href: "/goals",
    });
  }

  for (const e of input.upcomingEvents) {
    out.push({
      type: "event_proximity",
      severity: "info",
      message: `${e.date.slice(5)} · ${e.text}`,
      href: "/earnings",
    });
  }

  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** Counts by severity, for a badge. */
export function alertCounts(alerts: readonly Alert[]): Record<AlertSeverity, number> {
  return {
    critical: alerts.filter((a) => a.severity === "critical").length,
    warning: alerts.filter((a) => a.severity === "warning").length,
    info: alerts.filter((a) => a.severity === "info").length,
  };
}
