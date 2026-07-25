// Server functions exposing live market data to the client (CORS-safe).
// Usage in a route/component:
//   const snap = await getMarketSnapshotFn();
//   const prices = await getPricesFn({ data: { symbols: ["MSFT", "CRWD"] } });
import { createServerFn } from "@tanstack/react-start";
import { fetchMarketSnapshot, fetchPrices, type MarketSnapshot } from "./market";

export const getMarketSnapshotFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<MarketSnapshot> => fetchMarketSnapshot(),
);

export const getPricesFn = createServerFn({ method: "POST" })
  .validator((input: { symbols: string[] }) => input)
  .handler(async ({ data }): Promise<Record<string, number>> => fetchPrices(data.symbols ?? []));

export interface LiveQuote { price: number; prevClose: number; changePct: number; }

/** Full quotes (with previous close) for daily gain/loss computation. */
export const getQuotesFn = createServerFn({ method: "POST" })
  .validator((input: { symbols: string[] }) => input)
  .handler(async ({ data }): Promise<Record<string, LiveQuote>> => {
    const { fetchQuotes } = await import("./market");
    return fetchQuotes(data.symbols ?? []);
  });
