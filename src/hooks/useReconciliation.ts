// One reconciliation for the account in scope, shared by every surface that
// shows or acts on it (§20.2, rule 11).
//
// `ReconciliationPanel` built the comparison inline. The alerts aggregator
// then needed the same status to raise `reconciliation_needed`, and a second
// copy of the mapping — however faithful on the day it was written — is the
// arrangement under which the panel and the alert eventually disagree about
// whether the account reconciles, while both render a confident answer.
import { useAccountScope } from "@/contexts/AccountContext";
import { useAccounts, useLatestBalance } from "@/hooks/useAppData";
import type { AccountBalanceRow } from "@/hooks/useAppData";
import type { AccountTotals } from "@/lib/accountTotals";
import { DEFAULT_TOLERANCE, reconcileAccount } from "@/lib/reconciliation";
import type { ReconciliationResult } from "@/lib/reconciliation";
import { reconciliationInputFor } from "@/lib/reconciliationInput";
import type { Account } from "@/hooks/useAppData";

export type Reconciliation = {
  /** False when no single account is in scope: reconciliation is per account. */
  inScope: boolean;
  /** True while the latest balance is still loading — nothing can be said yet. */
  isLoading: boolean;
  account: Account | null;
  latest: AccountBalanceRow | null;
  /** Null while out of scope or loading. */
  result: ReconciliationResult | null;
};

export function useReconciliation(totals: AccountTotals | null): Reconciliation {
  const scope = useAccountScope();
  const { data: accounts = [] } = useAccounts();
  const { data: latest, isLoading } = useLatestBalance(scope);
  const inScope = scope.kind === "account";
  if (!inScope || isLoading) {
    return { inScope, isLoading, account: null, latest: null, result: null };
  }
  const account = accounts.find((a) => a.id === scope.accountId) ?? null;
  const result = reconcileAccount(
    reconciliationInputFor({
      latestValue: latest?.total_account_value ?? null,
      latestAsOf: latest?.imported_at ?? null,
      account,
      calculatedValue: totals?.totalAccountValue ?? null,
    }),
    DEFAULT_TOLERANCE,
  );
  return { inScope, isLoading, account, latest: latest ?? null, result };
}
