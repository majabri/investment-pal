// The first `domain_events` consumer (ADR-APP-018): GoalChanged → the goal
// caches in this tab, then the cursor. One writer, the RPC; the decision of
// what to do with a page of events is `lib/eventConsumers.ts`, pure.
//
// Register at the present (the database does that), read `id > cursor` on an
// interval, invalidate what a GoalChanged makes stale, advance. A failed
// advance leaves the cursor where it was and the next pass tries again; the
// database never lets the cursor move backwards or past the last event.
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabaseClient";
import {
  GOAL_CACHE_CONSUMER,
  OUTBOX_PAGE,
  consumePlan,
  readOutboxRows,
  type CursorRowLike,
  type OutboxRowLike,
} from "@/lib/eventConsumers";

const CURSOR_KEY = ["event_cursor", GOAL_CACHE_CONSUMER] as const;
const OUTBOX_KEY = (cursor: number) => ["outbox", GOAL_CACHE_CONSUMER, cursor] as const;
const CURSORS_KEY = ["event_consumers"] as const;

export function useGoalCacheConsumer(pollMs = 30_000) {
  const qc = useQueryClient();

  const cursorQuery = useQuery({
    queryKey: CURSOR_KEY,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc("register_event_consumer", { p_name: GOAL_CACHE_CONSUMER });
      if (error) throw error;
      return Number(data);
    },
    staleTime: Infinity,
  });
  const cursor = cursorQuery.data;

  const outbox = useQuery({
    queryKey: OUTBOX_KEY(cursor ?? -1),
    enabled: cursor !== undefined,
    queryFn: async (): Promise<OutboxRowLike[]> => {
      const { data, error } = await supabase
        .from("domain_events")
        .select("id,event_type")
        .gt("id", cursor ?? 0)
        .order("id", { ascending: true })
        .limit(OUTBOX_PAGE);
      if (error) throw error;
      return (data ?? []) as OutboxRowLike[];
    },
    refetchInterval: pollMs,
  });

  const advance = useMutation({
    mutationFn: async (next: number): Promise<number> => {
      const { data, error } = await supabase.rpc("advance_event_cursor", {
        p_name: GOAL_CACHE_CONSUMER,
        p_last_event_id: next,
      });
      if (error) throw error;
      return Number(data);
    },
    onSuccess: (n) => {
      qc.setQueryData(CURSOR_KEY, n);
      qc.invalidateQueries({ queryKey: CURSORS_KEY });
      qc.invalidateQueries({ queryKey: ["activity"] }); // consumed_at may have moved
    },
  });

  // The page this tab is already handling; a refetch of the same page must not
  // invalidate twice or advance twice.
  const handling = useRef<number | null>(null);

  useEffect(() => {
    if (cursor === undefined || !outbox.data) return;
    const { events } = readOutboxRows(outbox.data);
    const plan = consumePlan(events, cursor);
    if (plan.handled === 0 || plan.next <= cursor) return;
    if (handling.current === plan.next || advance.isPending) return;
    handling.current = plan.next;
    for (const key of plan.invalidate) qc.invalidateQueries({ queryKey: [...key] });
    advance.mutate(plan.next, { onError: () => { handling.current = null; } });
    // `advance` is stable per React Query; `qc` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, outbox.data, advance.isPending]);

  return { cursor, registered: cursorQuery.isSuccess, failed: cursorQuery.isError || outbox.isError || advance.isError };
}

/** Every consumer's cursor for this owner. Read-only; RLS scopes it. */
export function useEventCursors() {
  return useQuery({
    queryKey: CURSORS_KEY,
    queryFn: async (): Promise<CursorRowLike[]> => {
      const { data, error } = await supabase
        .from("event_consumers")
        .select("name,last_event_id,updated_at")
        .order("name");
      if (error) throw error;
      return (data ?? []) as CursorRowLike[];
    },
  });
}
