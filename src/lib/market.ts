// Live market data via Yahoo Finance public chart endpoint — no API key.
// Server-side only (Yahoo blocks browser CORS): call through the server
// function in src/lib/marketServer.ts.

export interface Quote {
  symbol: string;
  price: number;
  prevClose: number;
  changePct: number;
}

export interface MarketSnapshot {
  asOf: string;
  quotes: Record<string, Quote | null>; // keyed by friendly name
  headlinesNote: string;
}

const CORE: Record<string, string> = {
  "S&P 500": "^GSPC",
  Nasdaq: "^IXIC",
  Dow: "^DJI",
  "Russell 2000": "^RUT",
  VIX: "^VIX",
  "10Y Yield": "^TNX",
  "Oil (WTI)": "CL=F",
  Gold: "GC=F",
  Bitcoin: "BTC-USD",
  "US Dollar": "DX-Y.NYB",
};

/** Yahoo symbol form: share classes use dashes (BRK.B → BRK-B); crypto pairs use dashes (BTC/USD → BTC-USD). */
const yahooSymbol = (s: string) => s.replace(".", "-").replace("/", "-");

async function quote(symbol: string): Promise<Quote | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}?range=1d&interval=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" } },
    );
    if (!res.ok) return null;
    const j = await res.json();
    const meta = j?.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice);
    const prev = Number(meta?.chartPreviousClose ?? meta?.previousClose);
    if (!Number.isFinite(price)) return null;
    const changePct =
      Number.isFinite(prev) && prev > 0 ? Math.round(((price - prev) / prev) * 10000) / 100 : 0;
    return { symbol, price, prevClose: prev, changePct };
  } catch {
    return null;
  }
}

/** Full morning tape. ~10 parallel requests; cache upstream if called often. */
export async function fetchMarketSnapshot(): Promise<MarketSnapshot> {
  const entries = await Promise.all(
    Object.entries(CORE).map(async ([name, sym]) => [name, await quote(sym)] as const),
  );
  const quotes = Object.fromEntries(entries);
  // ^TNX quotes yield×10 on some responses; normalize to percent.
  const tnx = quotes["10Y Yield"];
  if (tnx && tnx.price > 20) tnx.price = tnx.price / 10;
  return { asOf: new Date().toISOString(), quotes, headlinesNote: "" };
}

/** Live last prices for held symbols (portfolio refresh). */
export async function fetchPrices(symbols: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(
    [...new Set(symbols)].map(async (s) => {
      const q = await quote(s);
      if (q) out[s] = q.price;
    }),
  );
  return out;
}

/** Live quotes incl. previous close, keyed by requested symbol. */
export async function fetchQuotes(
  symbols: string[],
): Promise<Record<string, { price: number; prevClose: number; changePct: number }>> {
  const out: Record<string, { price: number; prevClose: number; changePct: number }> = {};
  await Promise.all(
    [...new Set(symbols)].map(async (s) => {
      const q = await quote(s.replace(".", "-"));
      if (q) out[s] = { price: q.price, prevClose: q.prevClose, changePct: q.changePct };
    }),
  );
  return out;
}
