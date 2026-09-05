// The readiness gate (Phase 5, rule 17).
//
// "Before any portfolio-dependent recommendation, run deterministic checks:
// reconciliation, position data, quote freshness, cash, margin, open orders,
// policy configuration. On failure, block ONLY what materially depends on the
// failed input, and say why. Research and informational features stay
// available."
//
// Two failure modes this is written against, and they pull in opposite
// directions:
//
//   * The one the app had. Recommendations were produced from whatever data
//     happened to be present. A committee prompt built on an account with no
//     imported balance still asked for position sizing, and the model obliged.
//     Nothing checked, so nothing could refuse.
//
//   * The one an over-eager gate would introduce. Blocking the whole app
//     because a quote is stale would make the news page, the economic
//     calendar and the journal unusable for a data problem none of them
//     depends on — and a gate people route around is not a gate.
//
// So the unit here is a CAPABILITY, not a screen, and each capability names the
// checks it materially depends on. `research` depends on none and can never be
// blocked; that is rule 17's second sentence, stated as data rather than as an
// intention.
//
// Deterministic on purpose: no model is consulted, and the same inputs always
// produce the same verdict. A gate a model can talk its way past is not a gate
// (rule 18).
import { isDecisionGrade, type Freshness } from "./freshness";
import { wasChecked, type ReconciliationStatus } from "./reconciliation";
import { policyIsConfirmed, type PolicySource } from "./policy";

/** The deterministic checks rule 17 names, in the order it names them. */
export const CHECK_IDS = [
  "reconciliation",
  "positions",
  "quotes",
  "cash",
  "margin",
  "open_orders",
  "policy",
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

/**
 * Three states, and the third is the point.
 *
 * `fail` means the check ran and the data is wrong. `unknown` means the check
 * could not run because the input is missing. They send the user to different
 * places — investigate versus import — and collapsing them into "not ok" is
 * the same conflation rule 13 forbids everywhere else.
 */
export type CheckState = "pass" | "fail" | "unknown";

export type ReadinessCheck = {
  id: CheckId;
  label: string;
  state: CheckState;
  /** What is wrong, in the user's terms. Never empty for a non-pass state. */
  detail: string;
};

export const CHECK_LABEL: Record<CheckId, string> = {
  reconciliation: "Reconciliation",
  positions: "Position data",
  quotes: "Quote freshness",
  cash: "Cash balance",
  margin: "Margin",
  open_orders: "Open orders",
  policy: "Policy configuration",
};

export type ReadinessInput = {
  /** NULL = no reconciliation has been attempted for this scope. */
  reconciliation: ReconciliationStatus | null;
  positions: Freshness;
  quotes: Freshness;
  /** NULL = not known. Rule 13 — this is not a balance of zero. */
  cash: number | null;
  /** NULL = not known, which is not FALSE. */
  marginEnabled: boolean | null;
  /** NULL = not known. Only consulted when margin is enabled. */
  marginUsed: number | null;
  /**
   * Whether the app can currently say what orders are open.
   *
   * There is no order model yet (Phase 6), so this is `false` for every
   * caller today — and that is the honest value. Rule 30: "Open-order status
   * unavailable", never "No open orders". A recommendation to buy, made
   * without knowing what is already committed to open orders, can double a
   * position by accident.
   */
  openOrdersKnown: boolean;
  /** Where the risk caps came from. A default nobody chose is not a policy. */
  policySource: PolicySource;
};

/**
 * Run every check. Deterministic, total, and free of React and of the Supabase
 * client so the rules are testable on their own.
 */
export function runChecks(input: ReadinessInput): ReadinessCheck[] {
  return [
    checkReconciliation(input.reconciliation),
    checkFreshness("positions", input.positions),
    checkFreshness("quotes", input.quotes),
    checkCash(input.cash),
    checkMargin(input.marginEnabled, input.marginUsed),
    checkOpenOrders(input.openOrdersKnown),
    checkPolicy(input.policySource),
  ];
}

function checkReconciliation(status: ReconciliationStatus | null): ReadinessCheck {
  const base = { id: "reconciliation" as const, label: CHECK_LABEL.reconciliation };
  if (status === null) {
    return { ...base, state: "unknown", detail: "No reconciliation has been run for this scope." };
  }
  // UNSUPPORTED is deliberately NOT a failure. An account with no broker
  // figure to compare against can never reconcile, and treating "no such
  // comparison exists" as a fault would block every manually-tracked account
  // forever — a gate that can never be satisfied is a gate people route
  // around.
  if (status === "UNSUPPORTED") {
    return {
      ...base,
      state: "unknown",
      detail: "No broker figure exists for this account, so nothing can be reconciled against it.",
    };
  }
  if (!wasChecked(status)) {
    return {
      ...base,
      state: "unknown",
      detail:
        status === "STALE"
          ? "The figures are too old to compare meaningfully."
          : status === "ERROR"
            ? "The comparison itself failed."
            : "An input is missing, so the comparison did not run.",
    };
  }
  // WARNING passes: rule 11 made it the band that is worth seeing and not
  // worth alarming, and a gate that blocks on it would block on rounding
  // drift at scale.
  if (status === "NOT_RECONCILED") {
    return {
      ...base,
      state: "fail",
      detail: "The broker's figure and the app's differ materially. One of them is wrong.",
    };
  }
  return { ...base, state: "pass", detail: "" };
}

function checkFreshness(id: "positions" | "quotes", f: Freshness): ReadinessCheck {
  const base = { id, label: CHECK_LABEL[id] };
  if (f === "UNAVAILABLE" || f === "UNKNOWN") {
    return {
      ...base,
      state: "unknown",
      detail:
        f === "UNAVAILABLE"
          ? "There is no figure at all."
          : "Nothing recorded when this data was true.",
    };
  }
  if (!isDecisionGrade(f)) {
    return { ...base, state: "fail", detail: "The data is too old to decide from." };
  }
  return { ...base, state: "pass", detail: "" };
}

function checkCash(cash: number | null): ReadinessCheck {
  const base = { id: "cash" as const, label: CHECK_LABEL.cash };
  if (cash === null || !Number.isFinite(cash)) {
    return { ...base, state: "unknown", detail: "The cash balance is not known." };
  }
  // A negative cash balance is a real state (a debit), not an error. It is
  // reported, not gated on.
  return { ...base, state: "pass", detail: "" };
}

function checkMargin(enabled: boolean | null, used: number | null): ReadinessCheck {
  const base = { id: "margin" as const, label: CHECK_LABEL.margin };
  if (enabled === null) {
    return {
      ...base,
      state: "unknown",
      detail: "Nobody has said whether this account has margin.",
    };
  }
  if (!enabled) return { ...base, state: "pass", detail: "" };
  if (used === null || !Number.isFinite(used)) {
    return {
      ...base,
      state: "unknown",
      detail: "Margin is enabled but the balance drawn is not known.",
    };
  }
  return { ...base, state: "pass", detail: "" };
}

function checkOpenOrders(known: boolean): ReadinessCheck {
  const base = { id: "open_orders" as const, label: CHECK_LABEL.open_orders };
  return known
    ? { ...base, state: "pass", detail: "" }
    : {
        ...base,
        state: "unknown",
        // Rule 30's example, verbatim in spirit: never "No open orders".
        detail:
          "Open-order status is unavailable — the app has no order data. It cannot tell an account with no open orders from one whose orders it cannot see.",
      };
}

function checkPolicy(source: PolicySource): ReadinessCheck {
  const base = { id: "policy" as const, label: CHECK_LABEL.policy };
  if (policyIsConfirmed(source)) return { ...base, state: "pass", detail: "" };
  return {
    ...base,
    state: "unknown",
    detail:
      source === "default"
        ? "The risk limits are the app's defaults; you have not set them."
        : source === "not_set"
          ? "No risk limits are set."
          : "The stored risk limits may be your choice or may be old defaults — the app cannot tell.",
  };
}

/**
 * What the app can be asked to do, and what each of those things materially
 * depends on.
 *
 * This table IS rule 17. "Block only what materially depends on the failed
 * input" is a claim about dependencies, and a claim about dependencies has to
 * be written down somewhere a test can read it — otherwise every screen
 * re-decides it and they disagree.
 */
export const CAPABILITY_DEPENDENCIES = {
  /**
   * Reading, news, calendars, journalling, looking at what you hold. Depends
   * on nothing and can never be blocked — rule 17's second sentence.
   */
  research: [],
  /**
   * Showing figures. Not a recommendation: a screen that says "Unavailable"
   * for what it does not know is exactly what rule 30 asks for, so gating it
   * would suppress the honest answer along with the dishonest one.
   */
  reporting: [],
  /** "Buy N shares" — the highest-stakes output the app produces. */
  position_sizing: [
    "reconciliation",
    "positions",
    "quotes",
    "cash",
    "margin",
    "open_orders",
    "policy",
  ],
  /** "Sell X, buy Y" across the portfolio. */
  rebalancing: ["reconciliation", "positions", "quotes", "policy"],
  /** Anything that says what borrowing to do or how much room there is. */
  margin_advice: ["reconciliation", "margin", "cash", "policy"],
  /** Progress towards a target, required pace, "ahead / behind". */
  goal_projection: ["positions", "quotes"],
  /** A committee brief that asks a model to recommend against the portfolio. */
  committee_recommendation: [
    "reconciliation",
    "positions",
    "quotes",
    "cash",
    "margin",
    "open_orders",
  ],
} as const satisfies Record<string, readonly CheckId[]>;

export type Capability = keyof typeof CAPABILITY_DEPENDENCIES;

export type Gate =
  | { allowed: true }
  | {
      allowed: false;
      /** The checks that blocked it, so the UI can say why without guessing. */
      because: ReadinessCheck[];
    };

/**
 * Whether a capability may run, given the checks.
 *
 * A capability is blocked when any check it depends on is `fail` OR `unknown`.
 * Both, deliberately: acting on data that is wrong and acting on data that is
 * absent are the same mistake from the user's side, and "we did not know, so
 * we assumed" is the thing this whole standard exists to remove. The two are
 * still reported differently, because the fix differs.
 *
 * A capability with no dependencies is always allowed, whatever else is
 * broken — that is the only way research stays available.
 */
export function gate(capability: Capability, checks: readonly ReadinessCheck[]): Gate {
  const needed = CAPABILITY_DEPENDENCIES[capability] as readonly CheckId[];
  if (needed.length === 0) return { allowed: true };
  const because = checks.filter((c) => needed.includes(c.id) && c.state !== "pass");
  return because.length === 0 ? { allowed: true } : { allowed: false, because };
}

/**
 * One sentence naming what is missing, for a banner or a prompt.
 *
 * Names the checks rather than counting them. "3 checks failed" makes the user
 * hunt; the whole point is that they can see which input to go and fix.
 */
export function blockedReason(g: Gate): string | null {
  if (g.allowed) return null;
  return g.because.map((c) => `${c.label}: ${c.detail}`).join(" ");
}

/**
 * Combine one account's checks into a set covering several accounts
 * (Phase 5b, rule 17).
 *
 * The worst state wins, per check: `fail` beats `unknown` beats `pass`. That
 * is the only combination that does not lie. A brief that covers three
 * custodial accounts and reports "cash: ok" because two of them have a balance
 * is telling the model the portfolio is fully known when a third of it is not,
 * and the model will size positions across all three.
 *
 * The detail names the accounts, because "cash balance not known" over three
 * accounts leaves the user opening each one to find out which.
 */
export function combineChecks(
  perAccount: { label: string; checks: readonly ReadinessCheck[] }[],
): ReadinessCheck[] {
  // No accounts is not a clean bill of health. There is nothing to check, so
  // nothing was checked, and every check says so — the same call
  // `combinedTarget` makes for an empty list of targets.
  if (perAccount.length === 0) {
    return CHECK_IDS.map((id) => ({
      id,
      label: CHECK_LABEL[id],
      state: "unknown" as const,
      detail: "There are no accounts in scope, so nothing was checked.",
    }));
  }

  const RANK: Record<CheckState, number> = { pass: 0, unknown: 1, fail: 2 };

  return CHECK_IDS.map((id) => {
    const rows = perAccount
      .map((a) => ({ label: a.label, check: a.checks.find((c) => c.id === id) }))
      .filter((r): r is { label: string; check: ReadinessCheck } => r.check !== undefined);

    // A check absent from every account cannot be reported as passing.
    if (rows.length === 0) {
      return {
        id,
        label: CHECK_LABEL[id],
        state: "unknown" as const,
        detail: "This check did not run.",
      };
    }

    const worst = rows.reduce((w, r) => (RANK[r.check.state] > RANK[w.check.state] ? r : w));
    if (worst.check.state === "pass") {
      return { id, label: CHECK_LABEL[id], state: "pass" as const, detail: "" };
    }

    const affected = rows
      .filter((r) => r.check.state === worst.check.state)
      .map((r) => r.label);
    return {
      id,
      label: CHECK_LABEL[id],
      state: worst.check.state,
      detail: `${affected.join(", ")}: ${worst.check.detail}`,
    };
  });
}
