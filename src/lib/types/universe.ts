// Investment Universe types (mirrors investment_universe table).
export type UniverseTier = "top100" | "top25" | "bench";

export interface UniverseEntry {
  id: string;
  symbol: string;
  company_name: string | null;
  tier: UniverseTier;
  replaces_symbol: string | null;   // replacement matrix: which holding this would displace
  business_quality: number | null;  // all scores 1-10
  growth: number | null;
  valuation: number | null;
  technical_strength: number | null;
  relative_strength: number | null;
  catalysts: string | null;
  macro_sensitivity: number | null;
  geopolitical_exposure: number | null;
  risk: number | null;
  overall_conviction: number | null;
  thesis: string | null;
  last_scored_at: string | null;
}
