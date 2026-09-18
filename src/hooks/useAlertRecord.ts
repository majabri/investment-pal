// The alert record's reads and its two writes (§23.1, §16.1).
//
// `raise_alerts` is the one path that raises, refreshes, re-raises and
// resolves; acknowledging is the holder's own UPDATE of `acknowledged_at`.
// Both are account-scoped server-side; the household scope (`account_id`
// NULL) exists in the table and has no caller yet.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AccountScope } from "@/lib/accountTotals";
import { supabase } from "@/lib/supabaseClient";
import { acknowledgePatch, readAlertRows } from "@/lib/alertRecord";
import type { AlertRowLike, RaisePayloadItem, StoredAlert } from "@/lib/alertRecord";

export type StoredAlerts = { alerts: StoredAlert[]; unreadable: number };

/** Open alerts recorded for the account in scope. */
export function useStoredAlerts(scope: AccountScope) {
  const accountId = scope.kind === "account" ? scope.accountId : null;
  return useQuery({
    queryKey: ["alerts", accountId],
    enabled: accountId !== null,
    queryFn: async (): Promise<StoredAlerts> => {
      const { data, error } = await supabase
        .from("alerts")
        .select("id,type,severity,message,href,fingerprint,first_raised_at,last_raised_at,resolved_at,acknowledged_at")
        .eq("account_id", accountId!)
        .is("resolved_at", null)
        .order("first_raised_at", { ascending: true });
      if (error) throw error;
      return readAlertRows((data ?? []) as AlertRowLike[]);
    },
  });
}

export type RaiseResult = { raised: number; reraised: number; refreshed: number; resolved: number };

/** Send the current set for one account. The database decides what changed. */
export function useRaiseAlerts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { accountId: string; items: RaisePayloadItem[] }): Promise<RaiseResult> => {
      const { data, error } = await supabase.rpc("raise_alerts", {
        p_account_id: p.accountId,
        p_alerts: p.items,
      });
      if (error) throw error;
      return (data ?? { raised: 0, reraised: 0, refreshed: 0, resolved: 0 }) as RaiseResult;
    },
    onSuccess: (_r, p) => qc.invalidateQueries({ queryKey: ["alerts", p.accountId] }),
  });
}

/** The holder says "seen". Only an open, unacknowledged row is touched. */
export function useAcknowledgeAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; accountId: string; now?: string }) => {
      const { error } = await supabase
        .from("alerts")
        .update(acknowledgePatch(p.now ?? new Date().toISOString()))
        .eq("id", p.id)
        .is("acknowledged_at", null)
        .is("resolved_at", null);
      if (error) throw error;
    },
    onSuccess: (_r, p) => qc.invalidateQueries({ queryKey: ["alerts", p.accountId] }),
  });
}
