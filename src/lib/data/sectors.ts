// Built-in sector classification for known symbols — the LAST RESORT source
// for `canonicalSector` (src/lib/securityMaster.ts), which owns the precedence
// order and reports which source answered. A sector saved on the holding, or on
// the security by a human, wins over everything here.
export const SECTOR_MAP: Record<string, string> = {
  // Semiconductors & AI infrastructure
  NVDA: "Semiconductors",
  AVGO: "Semiconductors",
  LRCX: "Semiconductors",
  TSM: "Semiconductors",
  AMD: "Semiconductors",
  ASML: "Semiconductors",
  // Software & Cloud
  MSFT: "Software & Cloud",
  NOW: "Software & Cloud",
  INTU: "Software & Cloud",
  // Cybersecurity
  CRWD: "Cybersecurity",
  PANW: "Cybersecurity",
  // Internet & Communication
  GOOGL: "Communication Services",
  META: "Communication Services",
  NFLX: "Communication Services",
  // Consumer
  AMZN: "Consumer Discretionary",
  TSLA: "Consumer Discretionary",
  COST: "Consumer Staples",
  // Financials
  RY: "Financials",
  V: "Financials",
  MA: "Financials",
  BLK: "Financials",
  "BRK.B": "Financials",
  // Healthcare
  ABT: "Healthcare",
  LLY: "Healthcare",
  // Crypto exposure
  GBTC: "Crypto (BTC)",
  CLSK: "Crypto (miners)",
  "BTC/USD": "Crypto (BTC)",
  "ETH/USD": "Crypto (ETH)",
  "SOL/USD": "Crypto (SOL)",
  // Commodities & Real Estate & Funds
  GLD: "Commodities",
  SLV: "Commodities",
  ARE: "Real Estate",
  FAMRX: "Funds",
  FFSFX: "Funds",
  // Legacy / dead positions
  CMGR: "Legacy / delisted",
  CCGY: "Legacy / delisted",
  CBYI: "Legacy / delisted",
  ARYX: "Legacy / delisted",
  DJSP: "Legacy / delisted",
};

// `sectorFor` used to live here. It resolved a sector from two sources and
// returned a bare string, so a caller could not tell whether a classification
// came from a human or from the map below — and a second call site with a
// different precedence would have been a second classification (UNIV-001).
//
// It is deleted rather than deprecated: a function with no callers that still
// answers the same question is how the second classification comes back. The
// one resolver is `canonicalSector` in `src/lib/securityMaster.ts`, which
// returns the source alongside the sector. This map is its last resort.
