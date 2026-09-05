// Assembling the readiness gate's inputs from live data (Phase 5, rule 17).
//
// The rules live in `src/lib/readiness.ts` and are pure; this is the wiring.
// Kept separate on purpose — a gate whose logic can only be exercised through
// React is a gate nobody tests, and rule 17 asks for DETERMINISTIC checks.
import { useMemo } from "react";

import { useAccountScope } from "@/contexts/AccountContext";
import { useAccounts, useIpsLite, useLatestBalance } from "@/hooks/useAppData";
import type { AccountTotals } from "@/lib/accountTotals";
import { freshnessOf, type Freshness, type SourceType } from "@/lib/freshness";
import { DEFAULT_TOLERANCE, reconcileAccount } from "@/lib/reconciliation";
import { reconciliationInputFor } from "@/lib/reconciliationInput";
import { runChecks, type ReadinessCheck } from "@/lib/readiness";

/**
 * The checks, for the currently selected scope.
 *
 * With no single account selected every check that needs one is reported as
 * unknown rather than passed. A blended or unresolved scope is not a scope
 * whose reconciliation, cash or margin can be stated, and passing them would
 * make the gate open widest exactly where the app knows least.
 */
export function useReadiness(totals: AccountTotals | null): ReadinessCheck[] {
  const scope = useAccountScope();
  const { data: accounts = [] } = useAccounts();
  const { data: latest } = useLatestBalance(scope);
  const { data: ips } = useIpsLite();

  const accountId = scope.kind === "account" ? scope.accountId : null;
  const account = accountId === null ? null : (accounts.find((a) => a.id === accountId) ?? null);

  return useMemo(() => {
    // The value comes first because `freshnessOf` short-circuits on it: there
    // is nothing to be fresh or stale ABOUT a figure that does not exist, and
    // the account's total is the figure the positions check is about.
    const positions: Freshness =
      account === null
        ? "UNAVAILABLE"
        : freshnessOf(totals?.totalAccountValue ?? null, {
            sourceType: (account.balances_source_type ?? null) as SourceType | null,
            asOf: account.balances_as_of ?? null,
          });

    // Quotes are re-fetched on a 60s cadence wherever a screen asks for them.
    // `live_quote` with the current moment is the honest description of that
    // for a screen that has just rendered; there is no per-symbol quote
    // timestamp in the schema yet, and inventing one would be worse.
    const quotes: Freshness =
      account === null
        ? "UNAVAILABLE"
        : freshnessOf(totals?.positionsValue ?? null, {
            sourceType: "live_quote",
            asOf: new Date().toISOString(),
          });

    const reconciliation =
      account === null
        ? null
        : reconcileAccount(
            reconciliationInputFor({
              latestValue: latest?.total_account_value ?? null,
              latestAsOf: latest?.imported_at ?? null,
              account,
              calculatedValue: totals?.totalAccountValue ?? null,
            }),
            DEFAULT_TOLERANCE,
          ).status;

    return runChecks({
      reconciliation,
      positions,
      quotes,
      cash: account?.cash ?? null,
      marginEnabled: account?.margin_enabled ?? null,
      marginUsed: account?.margin_used ?? null,
      // There is no order model yet — Phase 6. `false` is the honest value,
      // and rule 30 requires the app to say "unavailable" rather than let a
      // recommendation assume nothing is committed to an open order.
      openOrdersKnown: false,
      policySource: ips?.caps_source ?? "default",
    });
  }, [account, latest, totals, ips]);
}
