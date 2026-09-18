// The universe's write side (ADR-APP-017; UNIV-001). The parser is the
// boundary: what it refuses stays out, with a reason the screen can show, and
// nothing is clamped, defaulted or silently dropped. Symbols in this file are
// test fixtures, not a universe (see personalData.test.ts for the rule).
import { describe, expect, test } from "bun:test";

import {
  SCORE_COLUMNS,
  TEXT_COLUMNS,
  UNIVERSE_IMPORT_SOURCE,
  UNIVERSE_TIERS,
  parseScore,
  parseTier,
  parseUniverseText,
  previewSentence,
  universeCommittedPatch,
  universeStagedBatch,
  universeUpsertRows,
} from "../universeImport";

describe("parseScore", () => {
  test("a whole number 1–10 is a score", () => {
    expect(parseScore("7")).toEqual({ ok: true, value: 7 });
    expect(parseScore(" 1 ")).toEqual({ ok: true, value: 1 });
    expect(parseScore("10")).toEqual({ ok: true, value: 10 });
  });

  test("blank is no score, not zero", () => {
    expect(parseScore("")).toEqual({ ok: true, value: null });
    expect(parseScore("   ")).toEqual({ ok: true, value: null });
  });

  test("out of range is refused with the figure, never clamped", () => {
    const zero = parseScore("0");
    const eleven = parseScore("11");
    expect(zero.ok).toBe(false);
    expect(eleven.ok).toBe(false);
    if (!zero.ok) expect(zero.reason).toContain("0");
    if (!eleven.ok) expect(eleven.reason).toContain("11");
    // Negative control: the boundary values themselves pass.
    expect(parseScore("1").ok).toBe(true);
    expect(parseScore("10").ok).toBe(true);
  });

  test("a fraction or a word is refused, not rounded", () => {
    expect(parseScore("7.5").ok).toBe(false);
    expect(parseScore("high").ok).toBe(false);
  });
});

describe("parseTier", () => {
  test("accepts the three schema tiers in any case and spelling", () => {
    expect(parseTier("top100")).toBe("top100");
    expect(parseTier("Top 100")).toBe("top100");
    expect(parseTier("TOP-25")).toBe("top25");
    expect(parseTier("bench")).toBe("bench");
    expect(parseTier("Benchmark")).toBe("bench");
  });

  test("an unknown tier is null, never defaulted", () => {
    expect(parseTier("core")).toBeNull();
    expect(parseTier("top10")).toBeNull();
    expect(parseTier("")).toBeNull();
  });

  test("the tier list is the schema's three", () => {
    expect([...UNIVERSE_TIERS]).toEqual(["top100", "top25", "bench"]);
  });
});

describe("parseUniverseText — no header", () => {
  test("one symbol per line, default tier", () => {
    const p = parseUniverseText("aaa\nbbb\n");
    expect(p.hadHeader).toBe(false);
    expect(p.rows.map((r) => r.symbol)).toEqual(["AAA", "BBB"]);
    expect(p.rows.every((r) => r.tier === "top100")).toBe(true);
    expect(p.skipped).toEqual([]);
  });

  test("symbol,tier", () => {
    const p = parseUniverseText("aaa,top25\nbbb, bench\nccc");
    expect(p.rows.map((r) => [r.symbol, r.tier])).toEqual([["AAA", "top25"], ["BBB", "bench"], ["CCC", "top100"]]);
  });

  test("an unknown tier skips the line with the reason; it is not defaulted", () => {
    const p = parseUniverseText("aaa,core\nbbb");
    expect(p.rows.map((r) => r.symbol)).toEqual(["BBB"]);
    expect(p.skipped).toHaveLength(1);
    expect(p.skipped[0]!.line).toBe(1);
    expect(p.skipped[0]!.reason).toContain("core");
    expect(p.skipped[0]!.reason).toContain("bench");
  });

  test("blank lines are neither rows nor skips", () => {
    const p = parseUniverseText("\n\naaa\n\n  \nbbb\n");
    expect(p.rows).toHaveLength(2);
    expect(p.skipped).toEqual([]);
  });

  test("something that is not a ticker is skipped, with its line number", () => {
    const p = parseUniverseText("aaa\nnot@ticker\nbbb");
    expect(p.rows.map((r) => r.symbol)).toEqual(["AAA", "BBB"]);
    expect(p.skipped[0]!.line).toBe(2);
    expect(p.skipped[0]!.reason).toContain("not a ticker");
  });

  test("index and class forms survive normalisation", () => {
    const p = parseUniverseText("^spx\nbrk-b\nbrk.b");
    expect(p.rows.map((r) => r.symbol)).toEqual(["^SPX", "BRK-B", "BRK.B"]);
  });

  test("a repeated symbol is counted and the FIRST occurrence wins", () => {
    const p = parseUniverseText("aaa,top25\nbbb\nAAA,bench\n aaa ");
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0]).toMatchObject({ symbol: "AAA", tier: "top25" });
    expect(p.duplicates).toBe(2);
    expect(p.skipped).toHaveLength(2);
    expect(p.skipped.map((s) => s.line)).toEqual([3, 4]);
    expect(p.skipped[0]!.reason).toContain("repeated");
    // Negative control: distinct symbols are not duplicates.
    expect(parseUniverseText("aaa\nbbb").duplicates).toBe(0);
  });

  test("empty input is empty, not an error", () => {
    expect(parseUniverseText("")).toEqual({ rows: [], skipped: [], duplicates: 0, hadHeader: false });
    expect(parseUniverseText("\n  \n")).toEqual({ rows: [], skipped: [], duplicates: 0, hadHeader: false });
  });
});

describe("parseUniverseText — with header", () => {
  const csv = [
    "Symbol,Company,Tier,Quality,Growth,Valuation,Conviction,Thesis",
    "aaa,Alpha Corp,top25,8,7,,9,Leads its niche",
    "bbb,Beta Inc,bench,,,,,\"Benchmark, not a pick\"",
  ].join("\n");

  test("columns are matched by name and alias, in any order", () => {
    const p = parseUniverseText(csv);
    expect(p.hadHeader).toBe(true);
    expect(p.rows).toHaveLength(2);
    const a = p.rows[0]!;
    expect(a.symbol).toBe("AAA");
    expect(a.tier).toBe("top25");
    expect(a.scores).toEqual({ business_quality: 8, growth: 7, overall_conviction: 9 });
    expect(a.text).toEqual({ company_name: "Alpha Corp", thesis: "Leads its niche" });
  });

  test("a blank score is absent, not zero; a quoted comma stays in its cell", () => {
    const b = parseUniverseText(csv).rows[1]!;
    expect(b.scores).toEqual({});
    expect(b.text.thesis).toBe("Benchmark, not a pick");
    expect(b.tier).toBe("bench");
  });

  test("a tab-separated paste works the same way", () => {
    const p = parseUniverseText("ticker\ttier\trisk\naaa\ttop25\t3\n");
    expect(p.hadHeader).toBe(true);
    expect(p.rows[0]).toMatchObject({ symbol: "AAA", tier: "top25", scores: { risk: 3 } });
  });

  test("a score outside 1–10 skips the whole line, naming the column", () => {
    const p = parseUniverseText("symbol,growth\naaa,11\nbbb,10\nccc,0");
    expect(p.rows.map((r) => r.symbol)).toEqual(["BBB"]);
    expect(p.skipped).toHaveLength(2);
    expect(p.skipped[0]!.reason).toContain("growth");
    expect(p.skipped[0]!.reason).toContain("11");
    expect(p.skipped[1]!.reason).toContain("0");
    // Never clamped: no row carries a 10 or a 1 it did not have.
    expect(p.rows.some((r) => r.symbol === "AAA")).toBe(false);
    expect(p.rows.some((r) => r.symbol === "CCC")).toBe(false);
  });

  test("a blank tier cell keeps the default; an unknown one skips", () => {
    const p = parseUniverseText("symbol,tier\naaa,\nbbb,core");
    expect(p.rows).toEqual([{ symbol: "AAA", tier: "top100", scores: {}, text: {} }]);
    expect(p.skipped[0]!.reason).toContain("core");
  });

  test("a header without a symbol column is not a header", () => {
    const p = parseUniverseText("name,tier\naaa,top25");
    expect(p.hadHeader).toBe(false);
    // Treated as data: "name" is not a ticker → skipped; "tier" is not a tier either.
    expect(p.skipped).toHaveLength(1);
    expect(p.rows.map((r) => r.symbol)).toEqual(["AAA"]);
  });

  test("a row missing its symbol is skipped as such", () => {
    const p = parseUniverseText("symbol,tier\n,top25\naaa,top25");
    expect(p.skipped[0]!.reason).toBe("no symbol");
    expect(p.rows).toHaveLength(1);
  });

  test("unknown columns are ignored, not written", () => {
    const p = parseUniverseText("symbol,colour,risk\naaa,green,4");
    expect(p.rows[0]).toEqual({ symbol: "AAA", tier: "top100", scores: { risk: 4 }, text: {} });
  });

  test("replaces_symbol is normalised like a symbol", () => {
    const p = parseUniverseText("symbol,replaces\naaa, bbb ");
    expect(p.rows[0]!.text.replaces_symbol).toBe("BBB");
  });

  test("every score column and text column has an alias of its own name", () => {
    const header = ["symbol", ...SCORE_COLUMNS, ...TEXT_COLUMNS].join(",");
    const values = ["aaa", ...SCORE_COLUMNS.map((_, i) => String(i + 1)), "Co", "Why", "When", "zzz"].join(",");
    const p = parseUniverseText(`${header}\n${values}`);
    expect(Object.keys(p.rows[0]!.scores).sort()).toEqual([...SCORE_COLUMNS].sort());
    expect(p.rows[0]!.text).toEqual({ company_name: "Co", thesis: "Why", catalysts: "When", replaces_symbol: "ZZZ" });
  });
});

describe("universeUpsertRows", () => {
  const now = new Date("2026-09-18T20:00:00Z");

  test("writes user, symbol, tier, the scores and the text", () => {
    const [row] = universeUpsertRows(
      [{ symbol: "AAA", tier: "top25", scores: { risk: 3, growth: 8 }, text: { thesis: "t" } }],
      "user-1",
      now,
    );
    expect(row).toEqual({
      user_id: "user-1",
      symbol: "AAA",
      tier: "top25",
      risk: 3,
      growth: 8,
      thesis: "t",
      last_scored_at: "2026-09-18T20:00:00.000Z",
    });
  });

  test("last_scored_at is stamped only when a score exists", () => {
    const rows = universeUpsertRows(
      [
        { symbol: "AAA", tier: "top100", scores: {}, text: {} },
        { symbol: "BBB", tier: "top100", scores: { risk: 5 }, text: {} },
      ],
      "u",
      now,
    );
    expect(rows[0]!.last_scored_at).toBeNull();
    expect(rows[1]!.last_scored_at).toBe(now.toISOString());
  });

  test("a row without scores carries no score keys at all — the upsert must not zero them", () => {
    const [row] = universeUpsertRows([{ symbol: "AAA", tier: "top100", scores: {}, text: {} }], "u", now);
    for (const c of SCORE_COLUMNS) expect(c in row!).toBe(false);
  });
});

describe("import batch record", () => {
  test("the staged row opens before the write with the paste's identity", () => {
    const staged = universeStagedBatch({ userId: "u", checksum: "abc", sizeBytes: 42, parsedRows: 5, validRows: 4 });
    expect(staged).toMatchObject({
      user_id: "u",
      account_id: null,
      source: UNIVERSE_IMPORT_SOURCE,
      checksum_sha256: "abc",
      file_size_bytes: 42,
      parsed_rows: 5,
      valid_rows: 4,
      outcome: "staged",
    });
    expect(UNIVERSE_IMPORT_SOURCE).toBe("user_entry");
  });

  test("the committed patch closes it with the counts and the time", () => {
    const at = new Date("2026-09-18T20:01:00Z");
    expect(universeCommittedPatch(4, 1, at)).toEqual({
      outcome: "committed",
      diff: { universe: { upserted: 4, skipped: 1 } },
      finished_at: "2026-09-18T20:01:00.000Z",
    });
  });
});

describe("previewSentence", () => {
  test("nothing yet", () => {
    expect(previewSentence(parseUniverseText(""))).toBe("Nothing to import yet.");
  });

  test("counts ready, skipped and repeated, and says whether a header was seen", () => {
    const s = previewSentence(parseUniverseText("aaa\nbbb,core\naaa"));
    expect(s).toContain("1 symbol ready");
    expect(s).toContain("2 lines skipped");
    expect(s).toContain("1 repeated");
    expect(s).toContain("no header");
    const h = previewSentence(parseUniverseText("symbol\naaa\nbbb"));
    expect(h).toContain("2 symbols ready");
    expect(h).toContain("header recognised");
    expect(h).not.toContain("skipped");
  });
});
