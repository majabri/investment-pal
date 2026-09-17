// Server functions exposing live market data to the client (CORS-safe).
// Usage in a route/component:
//   const snap = await getMarketSnapshotFn();
//   const quotes = await getQuotesFn({ data: { symbols: ["AAA", "BBB"] } });
//
// `getPricesFn` — a bare number per symbol, no provenance — was removed with
// §B.2: its one caller (the refresh button) now takes the full quote and
// writes the quote's own time, and a server function with no caller is inert.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchMarketSnapshot, type MarketSnapshot } from "./market";
import type { ProvenancedQuote } from "./quoteProvenance";
import { symbolsInputSchema } from "./serverInput";
import { enforceProviderRateLimit } from "./serverRateLimit";

export const getMarketSnapshotFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MarketSnapshot> => {
    await enforceProviderRateLimit(context.supabase, "market");
    return fetchMarketSnapshot();
  });

/** A quote as the client receives it: the figures and their provenance (§B.2). */
export type LiveQuote = ProvenancedQuote;

/** Full quotes (with previous close) for daily gain/loss computation. */
export const getQuotesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => symbolsInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<Record<string, LiveQuote>> => {
    await enforceProviderRateLimit(context.supabase, "market");
    const { fetchQuotes } = await import("./market");
    return fetchQuotes(data.symbols);
  });
