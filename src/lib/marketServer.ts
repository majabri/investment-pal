// Server functions exposing live market data to the client (CORS-safe).
// Usage in a route/component:
//   const snap = await getMarketSnapshotFn();
//   const prices = await getPricesFn({ data: { symbols: ["MSFT", "CRWD"] } });
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchMarketSnapshot, fetchPrices, type MarketSnapshot } from "./market";
import { symbolsInputSchema } from "./serverInput";
import { enforceProviderRateLimit } from "./serverRateLimit";

export const getMarketSnapshotFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MarketSnapshot> => {
    await enforceProviderRateLimit(context.supabase, "market");
    return fetchMarketSnapshot();
  });

export const getPricesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => symbolsInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<Record<string, number>> => {
    await enforceProviderRateLimit(context.supabase, "market");
    return fetchPrices(data.symbols);
  });

export interface LiveQuote {
  price: number;
  prevClose: number;
  changePct: number;
}

/** Full quotes (with previous close) for daily gain/loss computation. */
export const getQuotesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => symbolsInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<Record<string, LiveQuote>> => {
    await enforceProviderRateLimit(context.supabase, "market");
    const { fetchQuotes } = await import("./market");
    return fetchQuotes(data.symbols);
  });
