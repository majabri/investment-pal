// Reading the InvestmentRecommendation contract off a `decisions` row.
//
// The evidence-contract columns have been written since the PR #63 migration
// and read by nothing. These helpers turn the raw JSONB into shapes a card can
// render, and they are deliberately pure — no React, no Supabase — so the
// parsing rules are unit-testable on their own.
//
// OD-008 is RESOLVED (Amir, 2026-09-03): the canonical contract is the 14-field
// `recommendation.schema.json` in `08 APIs/contracts/`, plus `objective_id`
// carried over from the superseded 10-field version. `supporting_evidence` is
// an array of `{source_id, claim}` objects — provenance is part of the
// contract, not an optional extra.
//
// String entries are still accepted when parsing. That is not hedging between
// contracts any more: it is tolerance for rows already in the table, written
// before the contract was settled. Such an entry renders as a claim with no
// recorded source, which is what it is.
//
// The one thing never done here is invention. Nothing is defaulted, inferred or
// summarised: a field the committee did not supply reads as absent, because
// AIOS §27 forbids manufacturing sourced evidence.

/** `action` enum from the canonical contract. */
export const RECOMMENDATION_ACTIONS = [
  "BUY", "SELL", "HOLD", "REDUCE", "ADD", "REBALANCE", "ROTATE", "WAIT", "ESCALATE",
] as const;
export type RecommendationAction = (typeof RECOMMENDATION_ACTIONS)[number];

/**
 * The 14 required fields of the canonical contract, plus `objective_id`.
 *
 * Kept as data so the conformance test asserts against the contract itself
 * rather than against a list retyped inside the test.
 */
export const RECOMMENDATION_REQUIRED_FIELDS = [
  "recommendation_id",
  "user_id",
  "ips_version",
  "action",
  "confidence",
  "supporting_evidence",
  "counterargument",
  "key_risks",
  "portfolio_impact",
  "probability_impact",
  "invalidation_conditions",
  "model_version",
  "prompt_version",
  "created_at",
  "objective_id",
] as const;

/**
 * Contract field name → `public.decisions` column, for the two places they
 * differ. Recorded in ADR-APP-008; renaming live columns buys nothing.
 */
export const CONTRACT_COLUMN_MAP: Readonly<Record<string, string>> = Object.freeze({
  recommendation_id: "id",
  supporting_evidence: "evidence",
});

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

/** An `action` value with whether it is one the contract recognises. */
export type ActionValue = { value: string; inContract: boolean };

/**
 * The action, preserving whatever is stored.
 *
 * Off-contract values exist in the table already — the shipped migration's own
 * comment lists `TRIM` and `MARGIN`, neither of which is in the enum. Those are
 * shown as written and flagged, never silently mapped onto a contract action:
 * quietly turning a stored `TRIM` into `REDUCE` would put a word on a governed
 * decision that the committee did not use.
 */
export function parseAction(raw: unknown): ActionValue | null {
  const s = textOf(raw);
  if (!s) return null;
  const upper = s.toUpperCase();
  const inContract = (RECOMMENDATION_ACTIONS as readonly string[]).includes(upper);
  return { value: inContract ? upper : s, inContract };
}

/** Provenance stamps. Absent on every row written before ADR-APP-008. */
export type Provenance = {
  ipsVersion: string | null;
  modelVersion: string | null;
  promptVersion: string | null;
  objectiveId: string | null;
};

/** The contract fields of a decision row, in raw (unparsed) form. */
export type DecisionEvidenceRow = {
  action?: unknown;
  confidence?: unknown;
  evidence?: unknown;
  counterargument?: unknown;
  key_risks?: unknown;
  portfolio_impact?: unknown;
  probability_impact?: unknown;
  invalidation_conditions?: unknown;
  ips_version?: unknown;
  model_version?: unknown;
  prompt_version?: unknown;
  objective_id?: unknown;
};

export type DecisionEvidence = {
  action: ActionValue | null;
  confidence: string | null;
  evidence: EvidenceItem[];
  counterargument: string | null;
  keyRisks: string[];
  portfolioImpact: ImpactEntry[];
  probabilityImpact: ImpactEntry[];
  invalidationConditions: string[];
  provenance: Provenance;
  /** False when every contract field is empty. */
  hasAny: boolean;
  /** False when no provenance stamp was recorded. */
  hasProvenance: boolean;
};

export function readDecisionEvidence(row: DecisionEvidenceRow): DecisionEvidence {
  const evidence = parseEvidence(row.evidence);
  const keyRisks = parseStringList(row.key_risks);
  const invalidationConditions = parseStringList(row.invalidation_conditions);
  const portfolioImpact = parseImpact(row.portfolio_impact);
  const probabilityImpact = parseImpact(row.probability_impact);
  const action = parseAction(row.action);
  const confidence = formatConfidence(row.confidence);
  const counterargument = textOf(row.counterargument) || null;

  const provenance: Provenance = {
    ipsVersion: textOf(row.ips_version) || null,
    modelVersion: textOf(row.model_version) || null,
    promptVersion: textOf(row.prompt_version) || null,
    objectiveId: textOf(row.objective_id) || null,
  };

  return {
    action,
    confidence,
    evidence,
    counterargument,
    keyRisks,
    portfolioImpact,
    probabilityImpact,
    invalidationConditions,
    provenance,
    hasAny:
      evidence.length > 0 ||
      keyRisks.length > 0 ||
      invalidationConditions.length > 0 ||
      portfolioImpact.length > 0 ||
      probabilityImpact.length > 0 ||
      action != null ||
      confidence != null ||
      counterargument != null,
    hasProvenance: Object.values(provenance).some((v) => v != null),
  };
}
