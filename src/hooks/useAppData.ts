// Central data hooks for the Investment Companion (all RLS-scoped to auth.uid()).
import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseClient";
import { MARGIN_POLICY_UNSET, type MarginPolicy } from "@/lib/marginCost";
import { scopedRows, type AccountScope } from "@/lib/accountTotals";
import type { BalanceSnapshotInsert } from "@/lib/balanceImport";

export type Goal = {
  id: string;
  user_id: string;
  name: string;
  starting_value: number;
  target_value: number;
  target_date: string;
  monthly_contribution: number;
  risk_preference: "conservative" | "moderate" | "aggressive";
  margin_preference: "none" | "conservative" | "moderate" | "aggressive";
  is_primary: boolean;
  created_at: string;
  updated_at: string;
};

export type Holding = {
  id: string;
  user_id: string;
  account_id: string | null;
  symbol: string;
  quantity: number;
  cost_basis: number;
  current_price: number;
  sector: string | null;
  original_thesis: string | null;
  current_thesis: string | null;
  why_own: string | null;
  notes: string | null;
  last_ai_review: string | null;
  last_reviewed_at: string | null;
  last_price_at: string | null;
  updated_at: string;
};

export type Account = {
  id: string;
  user_id: string;
  name: string;
  account_type: string;
  broker: string | null;
  cash: number;
  margin_used: number;
  margin_limit: number;
  buying_power: number;
  starting_value: number;
  target_value: number | null;
  target_date: string | null;
  notes: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};


export type Priority = {
  id: string;
  label: string;
  severity: "info" | "warning" | "critical";
  source: "system" | "user";
  active: boolean;
};

export type RecommendedAction = {
  id: string;
  category: "review" | "buy" | "hold" | "reduce" | "watch";
  symbol: string | null;
  rationale: string | null;
  source: "system" | "user";
  active: boolean;
};

export type JournalEntry = {
  id: string;
  entry_type:
    | "morning_review"
    | "eod_review"
    | "trade"
    | "ai_summary"
    | "note"
    | "lesson"
    | "decision";
  title: string | null;
  body: string;
  tickers: string[];
  tags: string[];
  ai_summary: string | null;
  created_at: string;
};

export type Profile = {
  id: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
};

/** The signed-in user's profile. Supplies the display name so screens do not
 *  hardcode a person (PR-UI-2). */
export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
  });
}

export function useGoal() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["goal"],
    queryFn: async (): Promise<Goal | null> => {
      const { data, error } = await supabase
        .from("goals")
        .select("*")
        .order("is_primary", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as Goal | null;
    },
  });

  const update = useMutation({
    mutationFn: async (patch: Partial<Goal> & { id: string }) => {
      const { id, ...rest } = patch;
      const { error } = await supabase.from("goals").update(rest).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goal"] }),
  });

  return { ...query, update };
}

/**
 * Every holding row the user owns, across every account.
 *
 * Renamed from `useHoldings` deliberately. It used to be the default, which
 * meant a screen got the whole household unless it remembered to filter — and
 * the dashboard, portfolio and goal figures all blended TOD with the IRA, the
 * kids' accounts, the 529s and crypto. Callers that genuinely want the whole
 * household now have to say so at the call site.
 *
 * For a single account use `useScopedHoldings`.
 */
export function useAllHoldings() {
  return useQuery({
    queryKey: ["holdings"],
    queryFn: async (): Promise<Holding[]> => {
      const { data, error } = await supabase
        .from("holdings")
        .select("*")
        .order("symbol");
      if (error) throw error;
      return (data ?? []) as Holding[];
    },
  });
}

/**
 * Holdings for one scope. There is no unscoped variant on purpose.
 *
 * `{ kind: "none" }` yields an empty list, never a fallback to everything —
 * a silent all-accounts fallback is exactly what produced the wrong totals.
 */
export function useScopedHoldings(
  scope: AccountScope,
  { includeUnassigned = false }: { includeUnassigned?: boolean } = {},
) {
  const query = useAllHoldings();
  const all = query.data;
  // The filter itself is `scopedRows`, pure and tested there — this hook is
  // only the React wiring around it.
  const data = useMemo(
    () => scopedRows(all ?? [], scope, { includeUnassigned }),
    [all, scope, includeUnassigned],
  );
  return { ...query, data };
}

export function useAccounts() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<Account[]> => {
      const { data, error } = await supabase
        .from("accounts")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Account[];
    },
  });
  const create = useMutation({
    mutationFn: async (patch: Partial<Account> & { name: string }) => {
      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("accounts")
        .insert({ ...patch, user_id: userData.user!.id })
        .select()
        .single();
      if (error) throw error;
      return data as Account;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...patch }: Partial<Account> & { id: string }) => {
      const { error } = await supabase.from("accounts").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("accounts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["holdings"] });
    },
  });
  return { ...query, create, update, remove };
}

/**
 * Cash / margin figures for one scope, and the write path back to them.
 *
 * This replaces `useAccount()`, which summed cash, margin_used, margin_limit and
 * buying_power across every account and returned that blend to the dashboard,
 * the portfolio, the goal screen and the prompt builder. There was no scope
 * argument, so no caller could opt out of the blend, and every screen that also
 * read `selectedAccount` used the aggregate as a `??` fallback — so a missing
 * figure on the selected account silently became the household's.
 *
 * The `upsert` was worse: it wrote to `accounts[0]` no matter which account was
 * selected. Editing "Cash & margin" while looking at the IRA wrote the IRA's
 * numbers onto the first account. That is a data-corruption path, and it is why
 * the mutation now refuses anything but a single named account.
 */
export type ScopedBalance = {
  cash: number;
  margin_used: number;
  margin_limit: number;
  buying_power: number;
  last_synced_at: string | null;
};

/** Sum a field across accounts, tolerating nulls from the database. */
const sumField = (accounts: Account[], key: keyof ScopedBalance): number =>
  accounts.reduce((s, a) => s + Number((a[key as keyof Account] as number | null) || 0), 0);

/** Latest non-null sync timestamp, or null when nothing has ever synced. */
const latestSync = (accounts: Account[]): string | null =>
  accounts
    .map((a) => a.last_synced_at)
    .filter((t): t is string => Boolean(t))
    .sort()
    .pop() ?? null;

export function useScopedAccount(scope: AccountScope) {
  const qc = useQueryClient();
  const { data: accounts = [], isLoading } = useAccounts();

  const data = useMemo<ScopedBalance | null>(() => {
    if (scope.kind === "none") return null;
    // An "all accounts" scope still blends — but now only because a caller
    // asked for it by name, and `scopeLabel` puts that on screen.
    const rows =
      scope.kind === "all" ? accounts : accounts.filter((a) => a.id === scope.accountId);
    // A scope that resolves to no rows is unknown, not zero. Returning zeroes
    // here would render "$0.00 cash" for an account that was simply not found.
    if (rows.length === 0) return null;
    return {
      cash: sumField(rows, "cash"),
      margin_used: sumField(rows, "margin_used"),
      margin_limit: sumField(rows, "margin_limit"),
      buying_power: sumField(rows, "buying_power"),
      last_synced_at: latestSync(rows),
    };
  }, [accounts, scope]);

  const upsert = useMutation({
    mutationFn: async (patch: Partial<Account>) => {
      // Deliberately no "write to the first account" fallback and no insert.
      // Both were silent: the first wrote one account's figures onto another,
      // the second invented an account named "Main". Accounts are created on
      // the Accounts screen and by import, where the user can see what happens.
      if (scope.kind !== "account") {
        throw new Error(
          "Select a single account before saving cash and margin — these figures belong to one account, not to a blend.",
        );
      }
      const { error } = await supabase.from("accounts").update(patch).eq("id", scope.accountId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });

  return { data, isLoading, upsert };
}


/**
 * The most recent balance import for a scope, and the write path for a new one.
 *
 * `account_balances` is append-only (Stage 2): every import inserts a row and
 * nothing is ever updated in place, because day change and accrued interest
 * only mean anything against previous observations. `accounts` still holds the
 * current figures the app computes with; this is the record of what the broker
 * said and when.
 */
export type AccountBalanceRow = BalanceSnapshotInsert & {
  id: string;
  imported_at: string;
};

export function useLatestBalance(scope: AccountScope) {
  const accountId = scope.kind === "account" ? scope.accountId : null;
  return useQuery({
    queryKey: ["account_balances", "latest", accountId],
    // No account, no query. A household-wide "latest balance" would be a blend
    // of different accounts' statements taken at different times.
    enabled: accountId !== null,
    queryFn: async (): Promise<AccountBalanceRow | null> => {
      const { data, error } = await supabase
        .from("account_balances" as never)
        .select("*")
        .eq("account_id", accountId!)
        .order("imported_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as AccountBalanceRow | null;
    },
  });
}

/** Every balance import for a scope, newest first. The history, for the chart. */
export function useBalanceHistory(scope: AccountScope, limit = 90) {
  const accountId = scope.kind === "account" ? scope.accountId : null;
  return useQuery({
    queryKey: ["account_balances", "history", accountId, limit],
    enabled: accountId !== null,
    queryFn: async (): Promise<AccountBalanceRow[]> => {
      const { data, error } = await supabase
        .from("account_balances" as never)
        .select("*")
        .eq("account_id", accountId!)
        .order("imported_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as AccountBalanceRow[];
    },
  });
}

/**
 * Record one balance import.
 *
 * Two writes, in this order: the append-only snapshot first, then the patch to
 * `accounts`. If the second fails the history still holds what the broker said,
 * which is recoverable; the reverse would leave the app's live figures updated
 * with no record of where they came from.
 *
 * The patch carries only the columns the paste actually supplied — writing a
 * zero for a figure the paste omitted is the silent partial accept this whole
 * stage exists to prevent.
 */
export function useRecordBalanceImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      snapshot,
      patch,
    }: {
      snapshot: BalanceSnapshotInsert;
      patch: Record<string, number>;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Not signed in");
      const { error: insertError } = await supabase
        .from("account_balances" as never)
        .insert({ ...snapshot, user_id: userData.user.id } as never);
      if (insertError) throw insertError;
      if (Object.keys(patch).length > 0) {
        const { error } = await supabase
          .from("accounts")
          .update({ ...patch, last_synced_at: new Date().toISOString() })
          .eq("id", snapshot.account_id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account_balances"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function usePriorities() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["priorities"],
    queryFn: async (): Promise<Priority[]> => {
      const { data, error } = await supabase
        .from("priorities")
        .select("*")
        .eq("active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Priority[];
    },
  });
  const add = useMutation({
    mutationFn: async (p: { label: string; severity?: Priority["severity"] }) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("priorities").insert({
        user_id: userData.user!.id,
        label: p.label,
        severity: p.severity ?? "info",
        source: "user",
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["priorities"] }),
  });
  const dismiss = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("priorities").update({ active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["priorities"] }),
  });
  return { ...query, add, dismiss };
}

export function useRecommendedActions() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["recommended_actions"],
    queryFn: async (): Promise<RecommendedAction[]> => {
      const { data, error } = await supabase
        .from("recommended_actions")
        .select("*")
        .eq("active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RecommendedAction[];
    },
  });
  const add = useMutation({
    mutationFn: async (p: Omit<RecommendedAction, "id" | "active" | "source"> & { source?: RecommendedAction["source"] }) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("recommended_actions").insert({
        user_id: userData.user!.id,
        source: p.source ?? "user",
        category: p.category,
        symbol: p.symbol,
        rationale: p.rationale,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recommended_actions"] }),
  });
  const dismiss = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("recommended_actions").update({ active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recommended_actions"] }),
  });
  return { ...query, add, dismiss };
}

export function useJournal(search = "") {
  return useQuery({
    queryKey: ["journal", search],
    queryFn: async (): Promise<JournalEntry[]> => {
      let q = supabase.from("journal_entries").select("*").order("created_at", { ascending: false });
      if (search.trim()) {
        const s = `%${search.trim()}%`;
        q = q.or(`title.ilike.${s},body.ilike.${s}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as JournalEntry[];
    },
  });
}

export function useAddJournal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      entry_type: JournalEntry["entry_type"];
      title?: string;
      body: string;
      tickers?: string[];
      tags?: string[];
      ai_summary?: string;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("journal_entries").insert({
        user_id: userData.user!.id,
        entry_type: p.entry_type,
        title: p.title ?? null,
        body: p.body,
        tickers: p.tickers ?? [],
        tags: p.tags ?? [],
        ai_summary: p.ai_summary ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["journal"] }),
  });
}

export function useSyncLog() {
  return useQuery({
    queryKey: ["sync_log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sync_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useLogSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { detail?: string; source?: string; status?: string }) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("sync_log").insert({
        user_id: userData.user!.id,
        source: p.source ?? "manual",
        status: p.status ?? "success",
        detail: p.detail ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sync_log"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export type IpsLite = {
  position_cap_pct: number;
  position_cap_hard: boolean;
  margin_cap_pct: number;
} & MarginPolicy;

/**
 * The stored investment universe.
 *
 * Unlike `useIpsLite`, this has NO fallback list. An empty universe means the
 * universe is empty, and the pages say so — falling back to a baked-in set of
 * symbols is exactly the defect this replaces.
 */
export function useUniverse() {
  return useQuery({
    queryKey: ["investment_universe"],
    queryFn: async (): Promise<{ symbol: string }[]> => {
      const { data, error } = await supabase
        .from("investment_universe" as never)
        .select("symbol")
        .order("symbol");
      if (error) throw error;
      return (data ?? []) as unknown as { symbol: string }[];
    },
  });
}

// Signed-off defaults (ADR-APP-004): 30% soft position cap, 25% margin cap.
export const IPS_LITE_DEFAULTS: IpsLite = {
  position_cap_pct: 30,
  position_cap_hard: false,
  margin_cap_pct: 25,
  // The caps have signed-off defaults (ADR-APP-004). The margin RATE does not
  // and must not (ADR-APP-007): unset means unset, and the UI suppresses the
  // cost figure rather than computing with a fallback.
  ...MARGIN_POLICY_UNSET,
};

// IPS-lite policy record (one row per user). Falls back to the signed-off
// defaults when unset, so the policy always has values.
export function useIpsLite() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["ips_lite"],
    queryFn: async (): Promise<IpsLite> => {
      const { data, error } = await supabase
        .from("ips_lite" as never)
        .select(
          "position_cap_pct,position_cap_hard,margin_cap_pct,margin_rate_annual_pct,margin_rate_as_of,margin_rate_is_floating,margin_rate_stale_days",
        )
        .limit(1);
      const rows = (data ?? []) as unknown as Partial<IpsLite>[];
      if (error || rows.length === 0) return IPS_LITE_DEFAULTS;
      const row = rows[0]!;
      return {
        position_cap_pct: Number(row.position_cap_pct ?? IPS_LITE_DEFAULTS.position_cap_pct),
        position_cap_hard: Boolean(row.position_cap_hard ?? IPS_LITE_DEFAULTS.position_cap_hard),
        margin_cap_pct: Number(row.margin_cap_pct ?? IPS_LITE_DEFAULTS.margin_cap_pct),
        // No `??` fallback on the rate — a null rate stays null all the way to
        // the screen. Coercing it to a number here is how a fallback sneaks in.
        margin_rate_annual_pct:
          row.margin_rate_annual_pct == null ? null : Number(row.margin_rate_annual_pct),
        margin_rate_as_of: row.margin_rate_as_of ?? null,
        margin_rate_is_floating: Boolean(
          row.margin_rate_is_floating ?? IPS_LITE_DEFAULTS.margin_rate_is_floating,
        ),
        margin_rate_stale_days: Number(
          row.margin_rate_stale_days ?? IPS_LITE_DEFAULTS.margin_rate_stale_days,
        ),
      };
    },
  });
  const save = useMutation({
    mutationFn: async (patch: Partial<IpsLite>) => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Not signed in");
      const { error } = await supabase
        .from("ips_lite" as never)
        .upsert({ user_id: userData.user.id, ...patch } as never, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ips_lite"] }),
  });
  return { ...query, data: query.data ?? IPS_LITE_DEFAULTS, save };
}
