// The universe ranked (UNIV-001 read side). Tier first, conviction second,
// unscored last and never as zero. Symbols are placeholders.
import { describe, expect, test } from "bun:test";

import { UNIVERSE_RANK_VERSION, rankUniverse, rankingSentence } from "../universeView";

const row = (symbol: string, tier: string | null, conviction: number | string | null, extra: Partial<{ last_scored_at: string | null; company_name: string | null }> = {}) => ({
  symbol,
  tier,
  overall_conviction: conviction,
  last_scored_at: extra.last_scored_at ?? null,
  company_name: extra.company_name ?? null,
});

describe("rankUniverse", () => {
  test("tier first: every top25 name outranks every top100 name, whatever the conviction", () => {
    const r = rankUniverse([row("AAA", "top100", 10), row("BBB", "top25", 3), row("CCC", "bench", 9)]);
    expect(r.names.map((n) => n.symbol)).toEqual(["BBB", "AAA", "CCC"]);
    expect(r.names.map((n) => n.rank)).toEqual([1, 2, 3]);
  });

  test("within a tier, higher conviction first; ties by symbol", () => {
    const r = rankUniverse([row("CCC", "top100", 7), row("AAA", "top100", 9), row("BBB", "top100", 7)]);
    expect(r.names.map((n) => n.symbol)).toEqual(["AAA", "BBB", "CCC"]);
  });

  test("an unscored name sorts LAST in its tier, not as a zero — and is counted", () => {
    const r = rankUniverse([row("AAA", "top100", null), row("BBB", "top100", 1), row("CCC", "top100", 5)]);
    expect(r.names.map((n) => n.symbol)).toEqual(["CCC", "BBB", "AAA"]);
    expect(r.names[2]!.conviction).toBeNull();
    expect(r.scored).toBe(2);
    expect(r.unscored).toBe(1);
  });

  test("a score that is not a whole 1–10 is unscored, not clamped", () => {
    const r = rankUniverse([row("AAA", "top100", 11), row("BBB", "top100", "abc"), row("CCC", "top100", "8")]);
    expect(r.names[0]).toMatchObject({ symbol: "CCC", conviction: 8 });
    expect(r.unscored).toBe(2);
  });

  test("a tier the schema does not name is shown last and counted, never defaulted", () => {
    const r = rankUniverse([row("AAA", "core", 10), row("BBB", "bench", null)]);
    expect(r.names.map((n) => n.symbol)).toEqual(["BBB", "AAA"]);
    expect(r.names[1]!.tier).toBe("unknown");
    expect(r.unknownTier).toBe(1);
  });

  test("deterministic: the same rows in another order give the same ranking", () => {
    const rows = [row("AAA", "top25", 5), row("BBB", "top100", null), row("CCC", "top25", 8)];
    const a = rankUniverse(rows).names.map((n) => n.symbol);
    const b = rankUniverse([...rows].reverse()).names.map((n) => n.symbol);
    expect(a).toEqual(b);
    expect(a).toEqual(["CCC", "AAA", "BBB"]);
  });

  test("carries the version and the row's provenance", () => {
    const r = rankUniverse([row("AAA", "top100", 6, { last_scored_at: "2026-09-18T20:00:00Z", company_name: "Alpha" })]);
    expect(r.version).toBe(UNIVERSE_RANK_VERSION);
    expect(r.names[0]).toMatchObject({ lastScoredAt: "2026-09-18T20:00:00Z", companyName: "Alpha" });
  });

  test("empty is empty", () => {
    expect(rankUniverse([])).toEqual({ version: UNIVERSE_RANK_VERSION, names: [], scored: 0, unscored: 0, unknownTier: 0 });
  });
});

describe("rankingSentence", () => {
  test("empty says so", () => {
    expect(rankingSentence(rankUniverse([]))).toContain("No names");
  });

  test("counts scored, unscored and unknown tiers, and names the rule and version", () => {
    const s = rankingSentence(rankUniverse([row("AAA", "top25", 9), row("BBB", "top100", null), row("CCC", "core", 2)]));
    expect(s).toContain("3 names");
    expect(s).toContain("2 with a conviction score");
    expect(s).toContain("1 unscored");
    expect(s).toContain("1 with a tier the schema does not name");
    expect(s).toContain(UNIVERSE_RANK_VERSION);
    // Negative control: nothing to warn about, nothing warned.
    expect(rankingSentence(rankUniverse([row("AAA", "top25", 9)]))).not.toMatch(/\d+ unscored/);
  });
});
