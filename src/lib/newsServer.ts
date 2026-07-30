// News engine — free RSS (CNBC, MarketWatch, Yahoo, CoinDesk), no keys.
// Server-side (CORS); importance = recency + magnitude keywords + relevance.
import { createServerFn } from "@tanstack/react-start";

export type NewsCategory = "Markets" | "Economy" | "Technology" | "Business" | "World" | "Crypto";
export interface NewsItem { title: string; link: string; source: string; publishedAt: string | null; description?: string; category: NewsCategory; score: number; }

const FEEDS: [string, string, NewsCategory][] = [
  ["https://www.cnbc.com/id/100003114/device/rss/rss.html", "CNBC", "Markets"],
  ["https://feeds.content.dowjones.io/public/rss/mw_topstories", "MarketWatch", "Markets"],
  ["https://www.cnbc.com/id/20910258/device/rss/rss.html", "CNBC", "Economy"],
  ["https://www.cnbc.com/id/19854910/device/rss/rss.html", "CNBC", "Technology"],
  ["https://www.cnbc.com/id/10001147/device/rss/rss.html", "CNBC", "Business"],
  ["https://www.cnbc.com/id/100727362/device/rss/rss.html", "CNBC", "World"],
  ["https://www.coindesk.com/arc/outboundfeeds/rss/", "CoinDesk", "Crypto"],
];

const decode = (s: string) => s.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();

async function fetchFeed(url: string, source: string, category: NewsCategory): Promise<NewsItem[]> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return [];
    const xml = await res.text();
    const out: NewsItem[] = [];
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const b = m[1];
      const title = decode(/<title>([\s\S]*?)<\/title>/.exec(b)?.[1] ?? "");
      const link = decode(/<link>([\s\S]*?)<\/link>/.exec(b)?.[1] ?? "");
      const pub = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(b)?.[1];
      const desc = decode(/<description>([\s\S]*?)<\/description>/.exec(b)?.[1] ?? "").replace(/<[^>]+>/g, "").slice(0, 240);
      if (title && link) out.push({ title, link, source, publishedAt: pub ? new Date(pub).toISOString() : null, description: desc || undefined, category, score: 0 });
      if (out.length >= 12) break;
    }
    return out;
  } catch { return []; }
}

const T1 = /\b(fed|fomc|cpi|inflation|crash|plunge|surge|record|war|tariff|rate (cut|hike)|recession)\b/i;
const T2 = /\b(earnings|guidance|ai|jobs|payrolls|gdp|oil|treasury|yield|nvidia|upgrade|downgrade|merger)\b/i;
const HELD = /\b(CRWD|LRCX|TSLA|RY|MSFT|AMZN|GOOGL|INTU|GBTC|AVGO|ABT|BLK|NVDA|META)\b/;

export const getNewsFn = createServerFn({ method: "GET" }).handler(async (): Promise<NewsItem[]> => {
  const all = (await Promise.all(FEEDS.map(([u, s, c]) => fetchFeed(u, s, c)))).flat();
  const seen = new Set<string>();
  const now = Date.now();
  const items = all.filter((i) => {
    const k = i.title.toLowerCase().slice(0, 60);
    if (seen.has(k)) return false; seen.add(k); return true;
  });
  for (const it of items) {
    const ageH = it.publishedAt ? (now - new Date(it.publishedAt).getTime()) / 3.6e6 : 48;
    it.score = (ageH < 1 ? 40 : ageH < 3 ? 32 : ageH < 6 ? 24 : ageH < 12 ? 16 : ageH < 24 ? 9 : 3)
      + (T1.test(it.title) ? 25 : T2.test(it.title) ? 12 : 0)
      + (HELD.test(it.title) ? 30 : 0);
  }
  return items.sort((a, b) => b.score - a.score).slice(0, 40);
});

// ─── Live geopolitics: derived from world/market news, impact-rated ───
export interface GeoItem { region: string; title: string; impact: "high" | "medium" | "low"; link: string; source: string; publishedAt: string | null; }

const REGIONS: [RegExp, string][] = [
  [/taiwan|china|beijing|xi jinping|pla\b/i, "China / Taiwan"],
  [/israel|gaza|iran|hezbollah|houthi|red sea|middle east|saudi|opec/i, "Middle East / Energy"],
  [/russia|ukraine|kremlin|putin|nato/i, "Russia / Ukraine"],
  [/tariff|trade war|sanction|export control|trade deal/i, "Trade / Tariffs"],
  [/semiconductor|chip ban|tsmc|asml export/i, "Semiconductors"],
  [/north korea|missile test/i, "North Korea"],
  [/election|coup|parliament/i, "Political"],
];
const GEO_HIGH = /war|strike|invasion|attack|sanction|export control|blockade|missile|tariff/i;

export const getGeopoliticsFn = createServerFn({ method: "GET" }).handler(async (): Promise<GeoItem[]> => {
  const world = await fetchFeed("https://www.cnbc.com/id/100727362/device/rss/rss.html", "CNBC", "World");
  const markets = await fetchFeed("https://feeds.content.dowjones.io/public/rss/mw_topstories", "MarketWatch", "Markets");
  const out: GeoItem[] = [];
  for (const n of [...world, ...markets]) {
    const region = REGIONS.find(([re]) => re.test(n.title))?.[1];
    if (!region) continue;
    out.push({
      region, title: n.title, link: n.link, source: n.source, publishedAt: n.publishedAt,
      impact: GEO_HIGH.test(n.title) ? "high" : "medium",
    });
  }
  const seen = new Set<string>();
  return out.filter((g) => { const k = g.title.slice(0, 50); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);
});
