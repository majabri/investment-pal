// Reading the evidence contract off a `decisions` row (PR-UI-3, gap G2).
//
// The eight evidence-contract columns have been written since the PR #63
// migration and read by nothing. These helpers turn the raw JSONB into shapes a
// card can render, and they are deliberately pure — no React, no Supabase — so
// the parsing rules are unit-testable on their own.
//
// Tolerance is intentional, not sloppy. `evidence` is JSONB and the certified
// contract is itself in dispute (OD-008): one version specifies
// `[{source_id, claim}]`, the other a plain `string[]`. Accepting both is
// correct under either outcome, and means this file does not have to change
// when that decision lands.
//
// The one thing never done here is invention. Nothing is defaulted, inferred or
// summarised: a field the committee did not supply reads as absent, because
// AIOS §27 forbids manufacturing sourced evidence.

/** A single supporting claim, with its source when the writer supplied one. */
export type EvidenceItem = {
  claim: string;
  /** Provenance. Absent when the stored value was a bare string. */
  source?: string;
};

/** One labelled line of a `portfolio_impact` / `probability_impact` object. */
export type ImpactEntry = {
  label: string;
  value: string;
};

function asArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  // JSONB can arrive already parsed, or as a JSON string from some clients.
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    if (s.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(s);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [s];
      }
    }
    return [s];
  }
  return [];
}

function textOf(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Supporting evidence, accepting either contract shape.
 *
 * Entries with no claim text are dropped rather than rendered blank — an empty
 * bullet reads as evidence that exists but says nothing.
 */
export function parseEvidence(raw: unknown): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (const entry of asArray(raw)) {
    if (typeof entry === "string") {
      const claim = entry.trim();
      if (claim) out.push({ claim });
      continue;
    }
    if (entry && typeof entry === "object") {
      const o = entry as Record<string, unknown>;
      const claim = textOf(o.claim) || textOf(o.text) || textOf(o.statement);
      // Both spellings appear across the two contract versions.
      const source = textOf(o.source_id) || textOf(o.source) || textOf(o.url);
      if (claim) out.push(source ? { claim, source } : { claim });
    }
  }
  return out;
}

/** `key_risks` / `invalidation_conditions` — string arrays in both contracts. */
export function parseStringList(raw: unknown): string[] {
  const out: string[] = [];
  for (const entry of asArray(raw)) {
    if (typeof entry === "string") {
      const s = entry.trim();
      if (s) out.push(s);
    } else if (entry && typeof entry === "object") {
      const o = entry as Record<string, unknown>;
      const s = textOf(o.text) || textOf(o.claim) || textOf(o.condition) || textOf(o.risk);
      if (s) out.push(s);
    }
  }
  return out;
}

/**
 * `portfolio_impact` / `probability_impact` are typed only as `object` in the
 * contract, so render whatever keys the committee supplied rather than assuming
 * a shape. Keys are humanised; nested values are stringified rather than
 * dropped, so nothing the model said disappears silently.
 */
export function parseImpact(raw: unknown): ImpactEntry[] {
  if (!raw) return [];

  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    if (s.startsWith("{")) {
      try {
        return parseImpact(JSON.parse(s));
      } catch {
        return [{ label: "", value: s }];
      }
    }
    return [{ label: "", value: s }];
  }

  if (Array.isArray(raw)) {
    return raw.map((v) => ({ label: "", value: impactValue(v) })).filter((e) => e.value);
  }

  if (typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .map(([k, v]) => ({ label: humaniseKey(k), value: impactValue(v) }))
      .filter((e) => e.value);
  }

  return [];
}

/**
 * One stringifier for both branches, so "absent reads as absent" holds
 * identically whether the impact arrived as an object or an array.
 *
 * `null` must map to "" and not to JSON.stringify's `"null"` — that string is
 * truthy, so it survives the caller's filter and renders the literal word
 * "null" on a governed decision. Missing data has to look missing.
 */
function impactValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return "";
  }
}

function humaniseKey(k: string): string {
  const s = k.replace(/[_-]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : k;
}

/**
 * Decision confidence as a percentage.
 *
 * Returns null for anything outside [0,1] rather than clamping: the column has
 * a CHECK constraint for that range, so an out-of-range value means the data is
 * wrong, and showing "100%" for a bad 4.2 would hide it.
 *
 * NOTE: this is how sure the reasoning is. It is NOT the probability of the
 * outcome — that is `probability_impact`, and the two are never combined.
 */
export function formatConfidence(raw: unknown): string | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return `${Math.round(n * 100)}%`;
}

/** The evidence-contract fields of a decision row, in raw (unparsed) form. */
export type DecisionEvidenceRow = {
  action?: unknown;
  confidence?: unknown;
  evidence?: unknown;
  counterargument?: unknown;
  key_risks?: unknown;
  portfolio_impact?: unknown;
  probability_impact?: unknown;
  invalidation_conditions?: unknown;
};

export type DecisionEvidence = {
  action: string | null;
  confidence: string | null;
  evidence: EvidenceItem[];
  counterargument: string | null;
  keyRisks: string[];
  portfolioImpact: ImpactEntry[];
  probabilityImpact: ImpactEntry[];
  invalidationConditions: string[];
  /** False when every contract field is empty — rows predating PR #63. */
  hasAny: boolean;
};

export function readDecisionEvidence(row: DecisionEvidenceRow): DecisionEvidence {
  const evidence = parseEvidence(row.evidence);
  const keyRisks = parseStringList(row.key_risks);
  const invalidationConditions = parseStringList(row.invalidation_conditions);
  const portfolioImpact = parseImpact(row.portfolio_impact);
  const probabilityImpact = parseImpact(row.probability_impact);
  const action = textOf(row.action) || null;
  const confidence = formatConfidence(row.confidence);
  const counterargument = textOf(row.counterargument) || null;

  return {
    action,
    confidence,
    evidence,
    counterargument,
    keyRisks,
    portfolioImpact,
    probabilityImpact,
    invalidationConditions,
    hasAny:
      evidence.length > 0 ||
      keyRisks.length > 0 ||
      invalidationConditions.length > 0 ||
      portfolioImpact.length > 0 ||
      probabilityImpact.length > 0 ||
      action != null ||
      confidence != null ||
      counterargument != null,
  };
}
