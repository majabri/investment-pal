// Turning one account's rows into the readiness gate's inputs (Phase 5).
//
// Pure, and extracted from the hook for the reason the gate itself is pure:
// there are now two callers — the single-account scope and the multi-account
// kids brief — and a second copy of this mapping would eventually disagree
// with the first about what "ready" means, while both rendered a verdict.
import { freshnessOf, type Freshness, type SourceType } from "./freshness";
import { DEFAULT_TOLERANCE, reconcileAccount } from "./reconciliation";
import { reconciliationInputFor, type ProvenancedAccount } from "./reconciliationInput";
import { runChecks, type ReadinessCheck, type ReadinessInput } from "./readiness";
import type { PolicySource } from "./policy";
import { openOrdersKnown } from "./orders";

export type ReadinessAccount = ProvenancedAccount & {
  cash: number | null;
  margin_enabled: boolean | null;
  margin_used: number | null;
  /** Phase 6: when the app was last told about this account's orders. */
  orders_as_of?: string | null;
  orders_source?: string | null;
};

export function readinessInputFor({
  account,
  totalAccountValue,
  positionsValue,
  latestValue,
  latestAsOf,
  policySource,
  now = new Date(),
}: {
  /** NULL = no account resolved. Every check that needs one is then unknown. */
  account: ReadinessAccount | null;
  totalAccountValue: number | null;
  positionsValue: number | null;
  latestValue: number | null;
  latestAsOf: string | null;
  policySource: PolicySource;
  now?: Date;
}): ReadinessInput {
  // The value comes first because `freshnessOf` short-circuits on it: there is
  // nothing to be fresh or stale ABOUT a figure that does not exist.
  const positions: Freshness =
    account === null
      ? "UNAVAILABLE"
      : freshnessOf(
          totalAccountValue,
          {
            sourceType: (account.balances_source_type ?? null) as SourceType | null,
            asOf: account.balances_as_of ?? null,
          },
          now,
        );

  // Quotes are re-fetched on a 60s cadence wherever a screen asks for them.
  // `live_quote` at the current moment is the honest description of that for a
  // screen that has just rendered; there is no per-symbol quote timestamp in
  // the schema yet, and inventing one would be worse than saying so here.
  const quotes: Freshness =
    account === null
      ? "UNAVAILABLE"
      : freshnessOf(positionsValue, { sourceType: "live_quote", asOf: now.toISOString() }, now);

  const reconciliation =
    account === null
      ? null
      : reconcileAccount(
          reconciliationInputFor({
            latestValue,
            latestAsOf,
            account,
            calculatedValue: totalAccountValue,
            now,
          }),
          DEFAULT_TOLERANCE,
        ).status;

  return {
    reconciliation,
    positions,
    quotes,
    cash: account?.cash ?? null,
    marginEnabled: account?.margin_enabled ?? null,
    marginUsed: account?.margin_used ?? null,
    // Phase 6 gave this an answer other than a hardcoded `false`. It is still
    // `false` for every account nobody has told the app about, which is the
    // shipped state and the honest one — and it becomes true only when the
    // orders were reported recently enough to decide from. An account with a
    // timestamp and no order rows IS known: the source was read and reported
    // nothing working (rule 30).
    openOrdersKnown: openOrdersKnown(
      account === null
        ? null
        : {
            orders_as_of: account.orders_as_of ?? null,
            orders_source: account.orders_source ?? null,
          },
      now,
    ),
    policySource,
  };
}

/** Convenience: the input and the checks in one step. */
export function readinessChecksFor(
  args: Parameters<typeof readinessInputFor>[0],
): ReadinessCheck[] {
  return runChecks(readinessInputFor(args));
}
