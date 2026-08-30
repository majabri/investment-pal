// Records one closing price per held symbol per calendar day into price_history.
// Best-effort daily capture that mirrors ProgressChart's snapshot approach: it
// writes whenever the Portfolio page is open, deduped to once per day via an
// idempotent upsert on (user_id, symbol, date). The backfill script
// (scripts/backfill-price-history.mjs) supplies authoritative historical closes.
// Renders nothing. Free source only — reuses the existing Yahoo quote layer (OD-002).
import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";

type QuoteMap = Record<string, { price: number }> | undefined;

export function PriceHistoryRecorder({ quotes }: { quotes: QuoteMap }) {
  // Guards against re-writing on the 60s live-quote refetch within the same day.
  const doneForDay = useRef<string | null>(null);

  useEffect(() => {
    if (!quotes) return;
    const symbols = Object.keys(quotes);
    if (symbols.length === 0) return;

    const today = new Date().toISOString().slice(0, 10);
    if (doneForDay.current === today) return;
    doneForDay.current = today; // optimistic; reset on failure so it can retry

    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        doneForDay.current = null;
        return;
      }

      const rows = symbols
        .filter((s) => {
          const p = quotes[s]?.price;
          return typeof p === "number" && Number.isFinite(p) && p > 0;
        })
        .map((s) => ({
          user_id: auth.user!.id,
          symbol: s,
          date: today,
          close: quotes[s]!.price,
          source: "yahoo",
        }));

      if (rows.length === 0) {
        doneForDay.current = null;
        return;
      }

      const { error } = await supabase
        .from("price_history" as never)
        .upsert(rows as never, { onConflict: "user_id,symbol,date" });

      // On error (e.g. migration not yet applied), allow a later retry.
      if (error) doneForDay.current = null;
    })();
  }, [quotes]);

  return null;
}
