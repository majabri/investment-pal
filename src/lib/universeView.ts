// The universe on screen, ranked (UNIV-001 read side; ADR-APP-017 made the
// owner its writer, #257). The screen showed symbols only; the table carries
// a tier and nine 1–10 scores the owner entered. This orders them.
//
// Deterministic, versioned, and honest about what is unscored: a name with
// no overall conviction is not a low-conviction name, it is an unscored one,
// and it sorts last within its tier rather than as a zero.
import { UNIVERSE_TIERS, type UniverseTier } from "./universeImport";

/** The rule, named, so a stored figure can say which ordering produced it (DATA-006). */
export const UNIVERSE_RANK_VERSION = "rank-v1";
export const UNIVERSE_RANK_RULE = "tier (top25, top100, bench), then overall conviction descending; unscored last; then symbol";

export type UniverseRowLike = {
  symbol: string;
  tier: string | null;
  overall_conviction: number | string | null;
  last_scored_at: string | null;
  company_name?: string | null;
};

export type RankedName = {
  rank: number;
  symbol: string;
  tier: UniverseTier | "unknown";
  conviction: number | null;
  lastScoredAt: string | null;
  companyName: string | null;
};

const TIER_ORDER: readonly string[] = ["top25", "top100", "bench"];

function tierOf(raw: string | null): UniverseTier | "unknown" {
  return raw !== null && (UNIVERSE_TIERS as readonly string[]).includes(raw) ? (raw as UniverseTier) : "unknown";
}

function convictionOf(raw: number | string | null): number | null {
  if (raw === null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
}

export type UniverseRanking = {
  version: typeof UNIVERSE_RANK_VERSION;
  names: RankedName[];
  scored: number;
  unscored: number;
  /** Rows whose tier is not one the schema names: shown, sorted last, counted. */
  unknownTier: number;
};

export function rankUniverse(rows: readonly UniverseRowLike[]): UniverseRanking {
  const names = rows
    .map((r) => ({
      rank: 0,
      symbol: r.symbol,
      tier: tierOf(r.tier),
      conviction: convictionOf(r.overall_conviction),
      lastScoredAt: r.last_scored_at,
      companyName: r.company_name ?? null,
    }))
    .sort((a, b) => {
      const ta = TIER_ORDER.indexOf(a.tier);
      const tb = TIER_ORDER.indexOf(b.tier);
      const ia = ta === -1 ? TIER_ORDER.length : ta;
      const ib = tb === -1 ? TIER_ORDER.length : tb;
      if (ia !== ib) return ia - ib;
      if (a.conviction !== b.conviction) {
        if (a.conviction === null) return 1;
        if (b.conviction === null) return -1;
        return b.conviction - a.conviction;
      }
      return a.symbol.localeCompare(b.symbol);
    })
    .map((n, i) => ({ ...n, rank: i + 1 }));
  return {
    version: UNIVERSE_RANK_VERSION,
    names,
    scored: names.filter((n) => n.conviction !== null).length,
    unscored: names.filter((n) => n.conviction === null).length,
    unknownTier: names.filter((n) => n.tier === "unknown").length,
  };
}

export const TIER_LABEL: Record<UniverseTier | "unknown", string> = {
  top25: "Top 25",
  top100: "Top 100",
  bench: "Bench",
  unknown: "Tier not recognised",
};

/** What the panel says above the list. */
export function rankingSentence(r: UniverseRanking): string {
  if (r.names.length === 0) return "No names in the universe yet. Paste some above.";
  const parts = [`${r.names.length} ${r.names.length === 1 ? "name" : "names"}`, `${r.scored} with a conviction score`];
  if (r.unscored > 0) parts.push(`${r.unscored} unscored (listed last in their tier, not as zero)`);
  if (r.unknownTier > 0) parts.push(`${r.unknownTier} with a tier the schema does not name`);
  return `${parts.join(" · ")}. Ordered by ${UNIVERSE_RANK_RULE} (${UNIVERSE_RANK_VERSION}).`;
}
