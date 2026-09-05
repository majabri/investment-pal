// Assembling the readiness gate's inputs from live data (Phase 5, rule 17).
//
// The rules live in `src/lib/readiness.ts` and the per-account mapping in
// `src/lib/readinessInput.ts`; both are pure. This file is only the React
// wiring — a gate whose logic can only be exercised through React is a gate
// nobody tests, and rule 17 asks for DETERMINISTIC checks.
import { useMemo } from "react";

import { useAccountScope } from "@/contexts/AccountContext";
import { useAccounts, useIpsLite, useLatestBalance, useLatestBalances } from "@/hooks/useAppData";
import type { AccountTotals } from "@/lib/accountTotals";
import { combineChecks, type ReadinessCheck } from "@/lib/readiness";
import { readinessChecksFor } from "@/lib/readinessInput";

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

  return useMemo(
    () =>
      readinessChecksFor({
        account,
        totalAccountValue: totals?.totalAccountValue ?? null,
        positionsValue: totals?.positionsValue ?? null,
        latestValue: latest?.total_account_value ?? null,
        latestAsOf: latest?.imported_at ?? null,
        policySource: ips?.caps_source ?? "default",
      }),
    [account, latest, totals, ips],
  );
}

/**
 * The checks across several accounts, combined worst-first
 * (Phase 5b, rule 17).
 *
 * For briefs that cover more than one account — the kids committee review.
 * A single-account gate applied to a multi-account brief would report the
 * wrong account's readiness, which is worse than no gate at all, so this
 * exists rather than reusing `useReadiness` with the selected scope.
 */
export function useMultiReadiness(
  accounts: { id: string; name: string; totals: AccountTotals | null }[],
): ReadinessCheck[] {
  const { data: allAccounts = [] } = useAccounts();
  const { data: ips } = useIpsLite();
  const ids = accounts.map((a) => a.id);
  const { data: balances = {} } = useLatestBalances(ids);

  // `ids.join` rather than the array: a new array of the same ids on every
  // render would recompute this on every render.
  const key = ids.join(",");

  return useMemo(
    () =>
      combineChecks(
        accounts.map((a) => {
          const row = allAccounts.find((x) => x.id === a.id) ?? null;
          const latest = balances[a.id];
          return {
            label: a.name,
            checks: readinessChecksFor({
              account: row,
              totalAccountValue: a.totals?.totalAccountValue ?? null,
              positionsValue: a.totals?.positionsValue ?? null,
              latestValue: latest?.total_account_value ?? null,
              latestAsOf: latest?.imported_at ?? null,
              policySource: ips?.caps_source ?? "default",
            }),
          };
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, accounts, allAccounts, balances, ips],
  );
}
