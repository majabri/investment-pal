// Live price check: pulls current quotes for the given symbols (Yahoo,
// server-side) and writes them onto holdings so every gain/loss updates.
import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getQuotesFn } from "@/lib/marketServer";
import { supabase } from "@/lib/supabaseClient";

export function useRefreshPrices(symbols: string[]) {
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  async function refresh() {
    if (!symbols.length || busy) return;
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error("Not signed in");
      const unique = [...new Set(symbols)];
      // Symbol quirks (BRK.B → BRK-B) are the provider layer's; the result is
      // keyed by the symbol as sent, upper-cased by the server's validator.
      const quotes = await getQuotesFn({ data: { symbols: unique } });
      let updated = 0;
      for (const sym of unique) {
        const q = quotes[sym] ?? quotes[sym.toUpperCase()];
        if (!q || !isFinite(q.price)) continue;
        // `last_price_at` is when the price was TRUE — the quote's own time —
        // not when this button was pressed (§B.2, DATA-002). NULL when the
        // provider did not say: "age not known" is the honest reading, and
        // stamping it with the click would make Friday's close look like now.
        const { error } = await supabase
          .from("holdings")
          .update({ current_price: q.price, last_price_at: q.quoteAsOf })
          .eq("user_id", userId)
          .eq("symbol", sym);
        if (!error) updated++;
      }
      toast.success(
        `Prices refreshed: ${updated}/${unique.length} symbols${updated < unique.length ? " (unlisted/legacy symbols keep their last price)" : ""}`,
      );
      // On-demand: refresh every live consumer immediately
      void qc.invalidateQueries({ queryKey: ["holdings"] });
      void qc.invalidateQueries({
        predicate: (q) =>
          [
            "pf-quotes",
            "daily-quotes",
            "pc-quotes",
            "kids-quotes",
            "market-tape",
            "snapshots",
          ].includes(String(q.queryKey[0])),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setBusy(false);
    }
  }

  return { refresh, busy };
}

export function RefreshPricesButton({ symbols }: { symbols: string[] }) {
  const { refresh, busy } = useRefreshPrices(symbols);
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => void refresh()}
      disabled={busy || !symbols.length}
    >
      <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
      {busy ? "Checking prices…" : "Refresh prices"}
    </Button>
  );
}
