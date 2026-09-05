// The objective for one account, and whether it is set at all (Phase 4, rule 20).
//
// This is the account-level sibling of `objective.ts`, which reads the primary
// GOAL row. They are deliberately separate readers rather than one generalised
// one: a goal's objective needs a starting value (progress is measured from it)
// and an account's does not (progress is measured from what the account is
// worth now). Folding them together would mean one of the two demanding a field
// it does not use, and reporting "unset" for an objective that is set.
//
// What it replaces: `FAMILY_POLICY.targetPerChild` (200_000),
// `FAMILY_POLICY.targetDate` ("2036-07-01") and `FAMILY_POLICY.contribution`
// ($100 every 14 days from a fixed anchor) — one household's objective,
// compiled into the application, rendered as every user's progress bar and
// stated to a model as every user's own goal.
//
// Rule 15 is why there is no default here. An unset target is UNSET; it is not
// zero, and it is not somebody else's number wearing the user's label.
import { isRealCalendarDate } from "./localDate";

export type ContributionPlan = {
  amountUsd: number;
  cadenceDays: number;
  anchorDate: string;
};

export type AccountObjectiveLike = {
  target_value: number | null;
  target_date: string | null;
  contribution_amount?: number | null;
  contribution_cadence_days?: number | null;
  contribution_anchor_date?: string | null;
};

export type AccountObjective =
  | {
      kind: "set";
      targetValue: number;
      targetDate: string;
      /**
       * NULL = no plan stated, which is NOT a plan of $0. A projection that
       * assumes no contributions because nobody was asked is a guess; one that
       * knows there are none is a projection. Consumers must be able to tell.
       */
      contribution: ContributionPlan | null;
    }
  | { kind: "unset"; missing: string[] };

const TARGET_FIELDS = [
  ["target value", (a: AccountObjectiveLike) => a.target_value],
  ["target date", (a: AccountObjectiveLike) => a.target_date],
] as const;

/**
 * Reads an account's objective, or reports precisely which parts are missing.
 *
 * A half-filled objective is UNSET. Everything downstream — progress, required
 * CAGR, the "Behind / On Track / Ahead" verdict — needs both the target and the
 * horizon, and computing from one plus a default for the other is the
 * fabrication this exists to prevent.
 */
export function accountObjectiveOf(account: AccountObjectiveLike): AccountObjective {
  const missing = TARGET_FIELDS.filter(([, read]) => {
    const v = read(account);
    if (v === null || v === undefined || v === "") return true;
    if (typeof v === "number") return !Number.isFinite(v);
    // Postgres rejects "2027-02-31" at the column, but this module is the
    // contract every consumer trusts and `kind: "set"` has to mean the date is
    // a real day whatever route the row took to get here.
    return !isRealCalendarDate(v);
  }).map(([label]) => label);

  if (missing.length > 0) return { kind: "unset", missing };

  return {
    kind: "set",
    targetValue: Number(account.target_value),
    targetDate: String(account.target_date),
    contribution: contributionOf(account),
  };
}

/**
 * The contribution plan, or `null` when it is not fully stated.
 *
 * All three parts or none. An amount with no cadence cannot be scheduled, and a
 * cadence with no anchor has no first date — a partial plan silently completed
 * with a default is a schedule the user never agreed to.
 */
export function contributionOf(account: AccountObjectiveLike): ContributionPlan | null {
  const amount = account.contribution_amount;
  const cadence = account.contribution_cadence_days;
  const anchor = account.contribution_anchor_date;
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return null;
  // A cadence of 0 never advances — `nextContributionDate` would not terminate.
  // The column has a CHECK, and this is the same rule at the boundary.
  if (cadence === null || cadence === undefined || !Number.isInteger(cadence) || cadence <= 0) {
    return null;
  }
  if (!anchor || !isRealCalendarDate(anchor)) return null;
  return { amountUsd: Number(amount), cadenceDays: cadence, anchorDate: anchor };
}

/**
 * The next contribution date on or after `from`.
 *
 * Takes the plan rather than reading a module constant, which is the whole
 * point: the version this replaces read `FAMILY_POLICY.contribution.anchorDate`
 * and so returned the same date for every user of the app.
 */
export function nextContributionDate(plan: ContributionPlan, from = new Date()): Date {
  const anchor = new Date(`${plan.anchorDate}T12:00:00`);
  const ms = plan.cadenceDays * 864e5;
  if (from <= anchor) return anchor;
  const periods = Math.ceil((from.getTime() - anchor.getTime()) / ms);
  return new Date(anchor.getTime() + periods * ms);
}

/**
 * The sum of a set of accounts' targets, or `null` when ANY of them has no
 * target set.
 *
 * All-or-nothing, for the same reason `sumField` is: "the total of the accounts
 * that happen to have a target" is not the household's target, and there is no
 * way to render it that does not read as one. `FAMILY_POLICY.familyTarget` was
 * a hardcoded 600_000 that happened to equal three times a hardcoded 200_000,
 * so the two could drift apart with nothing to notice.
 */
export function combinedTarget(objectives: readonly AccountObjective[]): number | null {
  // Nothing to add is a known fact — but "the household target across no
  // accounts" is not a figure anyone should see, so this is null rather than 0.
  // `[].reduce(..., 0)` returning 0 is how "$0.00 of a $600,000 target" would
  // have reached the screen.
  if (objectives.length === 0) return null;
  let total = 0;
  for (const o of objectives) {
    if (o.kind === "unset") return null;
    total += o.targetValue;
  }
  return total;
}
