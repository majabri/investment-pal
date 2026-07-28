// Built-in sector classification for known symbols. A sector saved on the
// holding (📄 dialog) always overrides. Unknown symbols stay Unclassified.
export const SECTOR_MAP: Record<string, string> = {
  // Semiconductors & AI infrastructure
  NVDA: "Semiconductors", AVGO: "Semiconductors", LRCX: "Semiconductors",
  TSM: "Semiconductors", AMD: "Semiconductors", ASML: "Semiconductors",
  // Software & Cloud
  MSFT: "Software & Cloud", NOW: "Software & Cloud", INTU: "Software & Cloud",
  // Cybersecurity
  CRWD: "Cybersecurity", PANW: "Cybersecurity",
  // Internet & Communication
  GOOGL: "Communication Services", META: "Communication Services", NFLX: "Communication Services",
  // Consumer
  AMZN: "Consumer Discretionary", TSLA: "Consumer Discretionary", COST: "Consumer Staples",
  // Financials
  RY: "Financials", V: "Financials", MA: "Financials", BLK: "Financials", "BRK.B": "Financials",
  // Healthcare
  ABT: "Healthcare", LLY: "Healthcare",
  // Crypto exposure
  GBTC: "Crypto (BTC)", CLSK: "Crypto (miners)", "BTC/USD": "Crypto (BTC)", "ETH/USD": "Crypto (ETH)", "SOL/USD": "Crypto (SOL)",
  // Commodities & Real Estate & Funds
  GLD: "Commodities", SLV: "Commodities", ARE: "Real Estate", FAMRX: "Funds", FFSFX: "Funds",
  // Legacy / dead positions
  CMGR: "Legacy / delisted", CCGY: "Legacy / delisted", CBYI: "Legacy / delisted",
  ARYX: "Legacy / delisted", DJSP: "Legacy / delisted",
};

export const sectorFor = (symbol: string, saved?: string | null): string => {
  if (saved && saved.trim()) return saved.trim();
  if (SECTOR_MAP[symbol]) return SECTOR_MAP[symbol];
  if (/^[0-9A-Z]{9}$/.test(symbol) && /\d/.test(symbol)) return "Legacy / delisted"; // CUSIP-shaped
  return "Unclassified";
};
