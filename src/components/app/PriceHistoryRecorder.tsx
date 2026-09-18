// Records the day's close per held symbol into price_history — and only a
// close. `lib/dailyClose.ts` decides which quotes qualify (the provider's own
// clock says the session ended) and which day they belong to (the exchange's
// calendar, not the user's). Deduped to one write per batch of symbol@date via
// an idempotent upsert on (user_id, symbol, date). The backfill script
// (scripts/backfill-price-history.mjs) supplies authoritative historical closes.
// Renders nothing. Free source only — the existing Yahoo quote layer (OD-002).
//
// Still client-triggered: nothing is recorded on a day nobody opens the page,
// and that day then shows as a gap (the notice on /portfolio), never as the
// previous close carried forward. A scheduled server job is the §27.1 item.
import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { closeBatchKey, dailyCloseRows } from "@/lib/dailyClose";
import type { ProvenancedQuote } from "@/lib/quoteProvenance";

export function PriceHistoryRecorder({
  quotes,
  onRecorded,
}: {
  quotes: Record<string, ProvenancedQuote> | undefined;
  /** Called after a successful write so the reader of price_history can refetch. */
  onRecorded?: (count: number) => void;
}) {
  // Guards against re-writing the same closes on the 60s live-quote refetch.
  // A new trading day produces a new key and is written.
  const doneKey = useRef<string | null>(null);

  useEffect(() => {
    const batch = dailyCloseRows(quotes);
    if (batch.rows.length === 0) return;
    const key = closeBatchKey(batch.rows);
    if (doneKey.current === key) return;
    doneKey.current = key; // optimistic; reset on failure so it can retry

    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        doneKey.current = null;
        return;
      }
      const user_id = auth.user.id;
      const { error } = await supabase
        .from("price_history")
        .upsert(
          batch.rows.map((r) => ({ user_id, ...r })),
          { onConflict: "user_id,symbol,date" },
        );
      if (error) {
        doneKey.current = null;
        return;
      }
      onRecorded?.(batch.rows.length);
    })();
  }, [quotes, onRecorded]);

  return null;
}
