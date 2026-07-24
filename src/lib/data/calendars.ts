// Reference calendars — seed data ported from the Investment OS demo layer.
// Edit freely; high-impact items surface as dashboard priorities.
export interface EconEvent { date: string; name: string; importance: "high" | "medium" | "low"; }
export interface EarningsEvt { date: string; symbol: string; session: "bmo" | "amc"; inPortfolio?: boolean; onWatchlist?: boolean; }
export interface GeoEvent { region: string; title: string; impact: "high" | "medium" | "low"; note: string; }

export const ECON_EVENTS: EconEvent[] = [
  { date: "2026-07-24", name: "CPI (June)", importance: "high" },
  { date: "2026-07-28", name: "FOMC Meeting begins", importance: "high" },
  { date: "2026-07-29", name: "FOMC Rate Decision + Powell presser", importance: "high" },
  { date: "2026-07-30", name: "GDP Q2 Advance", importance: "high" },
  { date: "2026-07-31", name: "Core PCE (June)", importance: "high" },
  { date: "2026-08-07", name: "Nonfarm Payrolls (July)", importance: "high" },
  { date: "2026-08-12", name: "PPI (July)", importance: "medium" },
  { date: "2026-08-14", name: "Retail Sales (July)", importance: "medium" },
];

export const EARNINGS_EVENTS: EarningsEvt[] = [
  { date: "2026-07-28", symbol: "MSFT", session: "amc", inPortfolio: true },
  { date: "2026-07-29", symbol: "META", session: "amc", onWatchlist: true },
  { date: "2026-07-30", symbol: "AMZN", session: "amc", inPortfolio: true },
  { date: "2026-07-30", symbol: "GOOGL", session: "amc", inPortfolio: true },
  { date: "2026-08-04", symbol: "PANW", session: "amc", onWatchlist: true },
  { date: "2026-08-19", symbol: "LRCX", session: "amc", inPortfolio: true },
  { date: "2026-08-26", symbol: "CRWD", session: "amc", inPortfolio: true },
  { date: "2026-08-27", symbol: "AVGO", session: "amc", inPortfolio: true },
];

export const GEO_EVENTS: GeoEvent[] = [
  { region: "China / Taiwan", title: "Export-control review on AI chips", impact: "high", note: "Direct read-through to semis (LRCX, AVGO, TSM watch)" },
  { region: "Middle East", title: "Shipping-lane tensions", impact: "medium", note: "Oil transit risk; watch WTI" },
  { region: "Trade / Tariffs", title: "Pharma tariff proposal (2028 start)", impact: "medium", note: "Sector rotation risk; LLY watch" },
  { region: "Russia / Ukraine", title: "Energy-infrastructure strikes", impact: "low", note: "European gas; limited US equity impact" },
];
