// Central data hooks for the Investment Companion (all RLS-scoped to auth.uid()).
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
  cash: number;
  margin_used: number;
  margin_limit: number;
  buying_power: number;
  last_synced_at: string | null;
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

export function useAccount() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["account"],
    queryFn: async (): Promise<Account | null> => {
      const { data, error } = await supabase
        .from("accounts")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as Account | null;
    },
  });
  const upsert = useMutation({
    mutationFn: async (patch: Partial<Account>) => {
      const { data: existing } = await supabase.from("accounts").select("id").limit(1).maybeSingle();
      const { data: userData } = await supabase.auth.getUser();
      const user_id = userData.user!.id;
      if (existing?.id) {
        const { error } = await supabase.from("accounts").update(patch).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("accounts").insert({ ...patch, user_id });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["account"] }),
  });
  return { ...query, upsert };
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
      qc.invalidateQueries({ queryKey: ["account"] });
    },
  });
}
