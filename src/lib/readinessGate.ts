// The four-state Readiness Gate (Blueprint §23.2).
//
// `readiness.ts` already answers "may this capability run?" as a BOOLEAN. The
// blueprint asks for four states, and the one that is missing is the one that
// matters most:
//
//   READY     required inputs available and fresh under policy
//   DEGRADED  some NONCRITICAL inputs unavailable; bounded conclusions allowed
//   BLOCKED   a CRITICAL input is unavailable or stale; the dependent
//             recommendation is prohibited
//   ERROR     the workflow failed; no implied all-clear
//
// Today a capability is allowed or refused. There is no way to run a review and
// say "this ran without open-order status, so anything about available room is
// not concluded here" — so the choice is between a full answer and no answer,
// and a user facing no answer will go and get one somewhere less careful.
//
// DEGRADED is not a softening of BLOCKED. It exists so the app can produce the
// conclusions it CAN support while naming the ones it cannot, which is exactly
// what §23.2 requires: "the output must clearly state what is unavailable and
// which conclusions are blocked."
//
// ERROR is separate from BLOCKED on purpose. A workflow that threw did not
// evaluate the inputs at all, and reporting that as "blocked on quotes" names a
// cause nobody established. §23.2: "no implied all-clear."
import { CAPABILITY_DEPENDENCIES } from "./readiness";
import type { Capability, CheckId, ReadinessCheck } from "./readiness";

export type GateState = "READY" | "DEGRADED" | "BLOCKED" | "ERROR";

/**
 * Which of a capability's inputs are CRITICAL to it.
 *
 * A critical input missing blocks the capability. A noncritical one degrades
 * it: the answer still runs, with the gap named.
 *
 * Split per capability rather than globally, because the same input carries
 * different weight in different answers. `open_orders` is critical to position
 * sizing — an unseen working order is size the user already has — and merely
 * degrading to a committee brief, which is prose a human reads rather than a
 * number they act on.
 *
 * Every id here must appear in that capability's dependency list; a test pins
 * it, because a typo would silently downgrade a critical input to noncritical.
 */
export const CRITICAL_INPUTS = {
  research: [],
  reporting: [],
  // Every input is critical: this is the highest-stakes output the app makes,
  // and a share count computed around a gap is still a share count.
  position_sizing: [
    "reconciliation",
    "positions",
    "quotes",
    "cash",
    "margin",
    "open_orders",
    "policy",
  ],
  rebalancing: ["reconciliation", "positions", "quotes", "policy"],
  margin_advice: ["reconciliation", "margin", "cash", "policy"],
  // Positions and quotes are the projection. Nothing else is.
  goal_projection: ["positions", "quotes"],
  // A brief is prose a human reads, so it can run without open-order status
  // provided it SAYS so. Reconciliation, positions and quotes stay critical:
  // a brief written against the wrong holdings is worse than no brief.
  committee_recommendation: ["reconciliation", "positions", "quotes"],
} as const satisfies Record<Capability, readonly CheckId[]>;

export type GateVerdict = {
  state: GateState;
  /** Critical inputs that are not passing. Empty unless BLOCKED. */
  blocking: ReadinessCheck[];
  /** Noncritical inputs that are not passing. Drives the DEGRADED caveat. */
  degrading: ReadinessCheck[];
};

/**
 * The gate for one capability.
 *
 * `failed` is the ERROR path: the caller could not evaluate the inputs. It
 * short-circuits everything, because a gate that reports BLOCKED after a crash
 * is naming a cause nobody established.
 */
export function gateState(
  capability: Capability,
  checks: readonly ReadinessCheck[],
  failed = false,
): GateVerdict {
  if (failed) return { state: "ERROR", blocking: [], degrading: [] };

  const needed = CAPABILITY_DEPENDENCIES[capability] as readonly CheckId[];
  const critical = CRITICAL_INPUTS[capability] as readonly CheckId[];
  // `unknown` counts against a capability exactly as `fail` does: acting on
  // data that is wrong and acting on data that is absent are the same mistake
  // from the user's side. They are still reported apart, because the fix
  // differs — the check's own `state` carries that.
  const notPassing = checks.filter((c) => needed.includes(c.id) && c.state !== "pass");

  const blocking = notPassing.filter((c) => critical.includes(c.id));
  const degrading = notPassing.filter((c) => !critical.includes(c.id));

  if (blocking.length > 0) return { state: "BLOCKED", blocking, degrading };
  if (degrading.length > 0) return { state: "DEGRADED", blocking: [], degrading };
  return { state: "READY", blocking: [], degrading: [] };
}

/**
 * What the output must say about its own limits (§23.2).
 *
 * `null` only when READY. Every other state produces a sentence, because a
 * degraded answer that does not say it is degraded is just a wrong answer with
 * good manners.
 */
export function gateCaveat(verdict: GateVerdict): string | null {
  switch (verdict.state) {
    case "READY":
      return null;
    case "ERROR":
      // Names no cause, because none was established.
      return "This could not be evaluated. Nothing here is an all-clear — the check itself failed.";
    case "BLOCKED":
      return `Not available: ${verdict.blocking
        .map((c) => `${c.label} (${c.detail})`)
        .join("; ")}. Conclusions that depend on these are prohibited.`;
    case "DEGRADED":
      return `Produced without ${verdict.degrading
        .map((c) => c.label.toLowerCase())
        .join(", ")}. Conclusions that depend on ${
        verdict.degrading.length === 1 ? "it" : "them"
      } are not drawn here.`;
  }
}

/** Whether the capability may produce output at all. BLOCKED and ERROR may not. */
export function mayRun(verdict: GateVerdict): boolean {
  return verdict.state === "READY" || verdict.state === "DEGRADED";
}
