// Importing the investment universe (ADR-APP-017; UNIV-001 write side).
//
// The table has every §9.2 dimension and nothing wrote it, so the
// Opportunities screen screened an empty list. The owner is the author
// (ADR-APP-017): a paste — CSV, TSV or one symbol per line, header optional —
// is parsed here, validated at the boundary, previewed, then upserted once on
// (user_id, symbol). The Committee reads this table and never writes it; the
// AI boundary (`AI_WRITABLE_TABLES`) is unchanged.
//
// Rules held here:
//   * A score outside 1–10 is skipped with its reason, never clamped.
//   * A tier outside the three the schema names is skipped, never defaulted.
//   * A symbol repeated in one paste is counted, and the first wins.
//   * `last_scored_at` is stamped only when the row carries at least one score.
import type { Insert, Update } from "@/lib/dbRows";
import { normaliseSymbol } from "./universe";

/** The three tiers the schema's comment names. No CHECK exists; this is the check. */
export const UNIVERSE_TIERS = ["top100", "top25", "bench"] as const;
export type UniverseTier = (typeof UNIVERSE_TIERS)[number];

/** The nine 1–10 scores, in the table's own column names. */
export const SCORE_COLUMNS = [
  "business_quality",
  "growth",
  "valuation",
  "technical_strength",
  "relative_strength",
  "macro_sensitivity",
  "geopolitical_exposure",
  "risk",
  "overall_conviction",
] as const;
export type ScoreColumn = (typeof SCORE_COLUMNS)[number];

/** The free-text columns a paste may carry. */
export const TEXT_COLUMNS = ["company_name", "thesis", "catalysts", "replaces_symbol"] as const;
export type TextColumn = (typeof TEXT_COLUMNS)[number];

export type UniverseRow = {
  symbol: string;
  tier: UniverseTier;
  scores: Partial<Record<ScoreColumn, number>>;
  text: Partial<Record<TextColumn, string>>;
};

export type UniverseParse = {
  rows: UniverseRow[];
  skipped: { line: number; text: string; reason: string }[];
  /** Repeated symbols in this paste; the first occurrence was kept. */
  duplicates: number;
  /** Whether a header row was recognised. */
  hadHeader: boolean;
};

const HEADER_ALIASES: Record<string, string> = {
  symbol: "symbol", ticker: "symbol", sym: "symbol",
  tier: "tier",
  company: "company_name", company_name: "company_name", name: "company_name",
  thesis: "thesis", catalysts: "catalysts", catalyst: "catalysts",
  replaces: "replaces_symbol", replaces_symbol: "replaces_symbol",
  business_quality: "business_quality", quality: "business_quality",
  growth: "growth", valuation: "valuation",
  technical_strength: "technical_strength", technical: "technical_strength",
  relative_strength: "relative_strength", rs: "relative_strength",
  macro_sensitivity: "macro_sensitivity", macro: "macro_sensitivity",
  geopolitical_exposure: "geopolitical_exposure", geopolitical: "geopolitical_exposure", geo: "geopolitical_exposure",
  risk: "risk",
  overall_conviction: "overall_conviction", conviction: "overall_conviction", overall: "overall_conviction",
};

function splitLine(line: string): string[] {
  const sep = line.includes("\t") ? "\t" : line.includes(",") ? "," : /\s{2,}/.test(line) ? /\s{2,}/ : null;
  if (sep === null) return line.trim().split(/\s+/);
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  const s = typeof sep === "string" ? sep : null;
  if (s === null) return line.trim().split(sep as RegExp).map((x) => x.trim());
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ;
    } else if (c === s && !inQ) { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** A 1–10 integer, or a reason it is not. Blank is allowed (no score). */
export function parseScore(raw: string): { ok: true; value: number | null } | { ok: false; reason: string } {
  const t = raw.trim();
  if (t === "") return { ok: true, value: null };
  if (!/^-?\d+$/.test(t)) return { ok: false, reason: `score "${t}" is not a whole number` };
  const n = Number(t);
  if (n < 1 || n > 10) return { ok: false, reason: `score ${n} is outside 1–10` };
  return { ok: true, value: n };
}

export function parseTier(raw: string): UniverseTier | null {
  const t = raw.trim().toLowerCase().replace(/[\s_-]/g, "");
  const map: Record<string, UniverseTier> = { top100: "top100", top25: "top25", bench: "bench", benchmark: "bench" };
  return map[t] ?? null;
}

/**
 * The paste as rows. With a header, columns are matched by name (aliases
 * above); without one, each line is `symbol` or `symbol,tier`. Every line that
 * does not become a row is in `skipped` with the reason, by line number.
 */
export function parseUniverseText(input: string): UniverseParse {
  const lines = input.split(/\r?\n/);
  const rows: UniverseRow[] = [];
  const skipped: UniverseParse["skipped"] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  let start = 0;
  let columns: string[] | null = null;
  const firstIdx = lines.findIndex((l) => l.trim() !== "");
  if (firstIdx === -1) return { rows, skipped, duplicates, hadHeader: false };
  const firstCells = splitLine(lines[firstIdx]!).map((c) => c.toLowerCase().replace(/[\s-]+/g, "_"));
  if (firstCells.some((c) => HEADER_ALIASES[c] === "symbol") && firstCells.filter((c) => c in HEADER_ALIASES).length >= 1) {
    columns = firstCells.map((c) => HEADER_ALIASES[c] ?? "");
    start = firstIdx + 1;
  }

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === "") continue;
    const cells = splitLine(raw);
    const row: UniverseRow = { symbol: "", tier: "top100", scores: {}, text: {} };
    const problems: string[] = [];

    if (columns) {
      columns.forEach((col, idx) => {
        const cell = cells[idx] ?? "";
        if (col === "symbol") row.symbol = normaliseSymbol(cell);
        else if (col === "tier") {
          if (cell.trim() === "") return;
          const t = parseTier(cell);
          if (t === null) problems.push(`tier "${cell.trim()}" is not one of ${UNIVERSE_TIERS.join(", ")}`);
          else row.tier = t;
        } else if ((SCORE_COLUMNS as readonly string[]).includes(col)) {
          const p = parseScore(cell);
          if (!p.ok) problems.push(`${col}: ${p.reason}`);
          else if (p.value !== null) row.scores[col as ScoreColumn] = p.value;
        } else if ((TEXT_COLUMNS as readonly string[]).includes(col)) {
          const v = col === "replaces_symbol" ? normaliseSymbol(cell) : cell.trim();
          if (v) row.text[col as TextColumn] = v;
        }
      });
    } else {
      row.symbol = normaliseSymbol(cells[0] ?? "");
      if (cells.length > 1 && (cells[1] ?? "").trim() !== "") {
        const t = parseTier(cells[1]!);
        if (t === null) problems.push(`tier "${cells[1]!.trim()}" is not one of ${UNIVERSE_TIERS.join(", ")}`);
        else row.tier = t;
      }
    }

    if (!/^[A-Z0-9.^=/-]{1,20}$/.test(row.symbol)) problems.unshift(row.symbol ? `symbol "${row.symbol}" is not a ticker` : "no symbol");
    if (problems.length) {
      skipped.push({ line: i + 1, text: raw.trim(), reason: problems.join("; ") });
      continue;
    }
    if (seen.has(row.symbol)) {
      duplicates++;
      skipped.push({ line: i + 1, text: raw.trim(), reason: `${row.symbol} repeated; the first occurrence was kept` });
      continue;
    }
    seen.add(row.symbol);
    rows.push(row);
  }
  return { rows, skipped, duplicates, hadHeader: columns !== null };
}

/** The rows the upsert writes. `last_scored_at` only where a score exists. */
export function universeUpsertRows(rows: readonly UniverseRow[], userId: string, now: Date = new Date()): Insert<"investment_universe">[] {
  return rows.map((r) => ({
    user_id: userId,
    symbol: r.symbol,
    tier: r.tier,
    ...r.scores,
    ...r.text,
    last_scored_at: Object.keys(r.scores).length > 0 ? now.toISOString() : null,
  }));
}

export const UNIVERSE_IMPORT_SOURCE = "user_entry" as const;
export const UNIVERSE_IMPORT_FILE = "universe paste";

/** The batch row opened before the write (staged), like the positions import. */
export function universeStagedBatch(input: { userId: string; checksum: string; sizeBytes: number; parsedRows: number; validRows: number }): Insert<"import_batches"> {
  return {
    user_id: input.userId,
    account_id: null,
    source: UNIVERSE_IMPORT_SOURCE,
    file_name: UNIVERSE_IMPORT_FILE,
    file_size_bytes: input.sizeBytes,
    checksum_sha256: input.checksum,
    parsed_rows: input.parsedRows,
    valid_rows: input.validRows,
    outcome: "staged",
  };
}

export function universeCommittedPatch(upserted: number, skipped: number, finishedAt: Date = new Date()): Update<"import_batches"> {
  return { outcome: "committed", diff: { universe: { upserted, skipped } }, finished_at: finishedAt.toISOString() };
}

/** What the preview says before the button is pressed. */
export function previewSentence(p: UniverseParse): string {
  if (p.rows.length === 0 && p.skipped.length === 0) return "Nothing to import yet.";
  const parts = [`${p.rows.length} ${p.rows.length === 1 ? "symbol" : "symbols"} ready`];
  if (p.skipped.length) parts.push(`${p.skipped.length} ${p.skipped.length === 1 ? "line" : "lines"} skipped`);
  if (p.duplicates) parts.push(`${p.duplicates} repeated`);
  return parts.join(" · ") + (p.hadHeader ? " (header recognised)" : " (no header: symbol, optional tier)") + ".";
}
