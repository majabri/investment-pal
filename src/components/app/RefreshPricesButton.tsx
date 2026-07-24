// Live price check: pulls current quotes for the given symbols (Yahoo,
// server-side) and writes them onto holdings so every gain/loss updates.
import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPricesFn } from "@/lib/marketServer";
import { supabase } from "@/integrations/supabase/client";

/** Yahoo symbol quirks (e.g. BRK.B → BRK-B). */
const toYahoo = (s: string) => s.replace(".", "-");

export function RefreshPricesButton({ symbols }: { symbols: string[] }) {
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
      const prices = await getPricesFn({ data: { symbols: unique.map(toYahoo) } });
      const now = new Date().toISOString();
      let updated = 0;
      for (const sym of unique) {
        const px = prices[toYahoo(sym)];
        if (!px || !isFinite(px)) continue;
        const { error } = await supabase.from("holdings")
          .update({ current_price: px, last_price_at: now })
          .eq("user_id", userId).eq("symbol", sym);
        if (!error) updated++;
      }
      toast.success(`Prices refreshed: ${updated}/${unique.length} symbols${updated < unique.length ? " (unlisted/legacy symbols keep their last price)" : ""}`);
      void qc.invalidateQueries({ queryKey: ["holdings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="secondary" onClick={() => void refresh()} disabled={busy || !symbols.length}>
      <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
      {busy ? "Checking prices…" : "Refresh prices"}
    </Button>
  );
}
