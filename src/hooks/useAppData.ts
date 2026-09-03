// Central data hooks for the Investment Companion (all RLS-scoped to auth.uid()).
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseClient";
import { MARGIN_POLICY_UNSET, type MarginPolicy } from "@/lib/marginCost";

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

export function useHoldings() {
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

// Aggregated view across all accounts — used by Dashboard/Portfolio/Prompt center.
export function useAccount() {
  const qc = useQueryClient();
  const { data: accounts = [], isLoading } = useAccounts();
  const aggregate = accounts.length
    ? {
        cash: accounts.reduce((s, a) => s + Number(a.cash || 0), 0),
        margin_used: accounts.reduce((s, a) => s + Number(a.margin_used || 0), 0),
        margin_limit: accounts.reduce((s, a) => s + Number(a.margin_limit || 0), 0),
        buying_power: accounts.reduce((s, a) => s + Number(a.buying_power || 0), 0),
        last_synced_at: accounts
          .map((a) => a.last_synced_at)
          .filter(Boolean)
          .sort()
          .pop() as string | null | undefined,
      }
    : null;
  const upsert = useMutation({
    mutationFn: async (patch: Partial<Account>) => {
      const primary = accounts[0];
      const { data: userData } = await supabase.auth.getUser();
      if (primary?.id) {
        const { error } = await supabase.from("accounts").update(patch).eq("id", primary.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("accounts")
          .insert({ ...patch, name: patch.name ?? "Main", user_id: userData.user!.id });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });
  return { data: aggregate, isLoading, upsert };
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
