// From the committee's structured output to rows in `decisions`, with the
// context the contract requires stamped on (CONST-003, DEC-003, DEC-004).
//
// The contract's RECOMMENDATION_REQUIRED_FIELDS lists `ips_version`,
// `model_version` and `prompt_version`. Until this module nothing in the app
// wrote any of them: the columns existed, the contract demanded them, and
// every row was written without. Provenance a reader could not see.
//
// Pure. The hook inserts; this decides what the row says.

import type { Insert } from "@/lib/dbRows";
import type { StructuredDecision } from "@/lib/committeeContract";
import type { MarginPolicy } from "@/lib/marginCost";
import type { GateVerdict } from "@/lib/readinessGate";
import { gateCaveat } from "@/lib/readinessGate";
import type { MeetingType } from "@/lib/prompts";

/**
 * A fingerprint of the policy in force when the committee ran.
 *
 * `ips_lite` has no version column; what identifies a policy is its values
 * and where they came from. Two runs under the same caps and the same rate
 * as-of get the same string; change any of them and it changes. Readable on
 * purpose — a reader of the ledger should be able to see "30% soft cap, 25%
 * margin cap, user-set" without a lookup.
 */
/**
 * The structural minimum of `IpsLite`, stated here rather than imported: the
 * hooks module owns the browser Supabase client, and a lib that imports from
 * it — even a type — pulls that client into the test typecheck (the
 * SnapshotRecorder incident). `IpsLite` is assignable to this.
 */
export type PolicyLike = {
  position_cap_pct: number;
  position_cap_hard: boolean;
  margin_cap_pct: number;
  caps_source: string;
} & MarginPolicy;

export function ipsVersionOf(ips: PolicyLike): string {
  const cap = `${ips.position_cap_pct}${ips.position_cap_hard ? "h" : "s"}`;
  const rate =
    ips.margin_rate_annual_pct === null
      ? "rate-unset"
      : `rate${ips.margin_rate_annual_pct}@${ips.margin_rate_as_of ?? "undated"}`;
  return `${ips.caps_source}:cap${cap}:mgn${ips.margin_cap_pct}:${rate}`;
}

/**
 * Whether decisions from this run may be recorded at all.
 *
 * BLOCKED means a critical input was missing — the committee reasoned from
 * a hole. ERROR means the gate itself could not run. Neither produces a
 * decision the ledger should carry as decision-ready; DEC-004 is exactly
 * this rule. DEGRADED may be recorded, with the caveat attached (below).
 */
export function mayRecord(verdict: GateVerdict): boolean {
  return verdict.state === "READY" || verdict.state === "DEGRADED";
}

/**
 * The readiness caveat as a risk line, or null when there is nothing to say.
 *
 * `decisions` has no readiness column yet. Until it does, the honest place
 * for "the committee could not verify X" is the FIRST key risk, where a
 * reader of the row sees it before the committee's own risks. Prefixed so it
 * can be told apart from a risk the model named.
 */
export const READINESS_RISK_PREFIX = "Readiness: ";

export function readinessRiskLine(verdict: GateVerdict): string | null {
  const caveat = gateCaveat(verdict);
  return caveat === null ? null : `${READINESS_RISK_PREFIX}${verdict.state} — ${caveat}`;
}

export type DecisionStamp = {
  userId: string;
  /** YYYY-MM-DD, the holder's local day. */
  today: string;
  meeting: MeetingType;
  goalVersionId: string | null;
  ipsVersion: string;
  /** The provider's model id as it reported it. NULL when the server did not say. */
  modelVersion: string | null;
  promptVersion: string;
  verdict: GateVerdict;
  /** Live prices by symbol, for `price_at_rec`. Not AI-derived — see aiBoundary. */
  quotes: Readonly<Record<string, { price: number } | undefined>>;
};

const REVIEW_TYPE: Record<MeetingType, string> = {
  Morning: "morning_review",
  "Mid-Day": "midday_review",
  Evening: "eod_review",
  Weekly: "weekly_review",
  Monthly: "monthly_review",
};

/**
 * One structured decision as the row to insert.
 *
 * `decision` is `pending`: the committee recommended, the holder has not yet
 * disposed (BR-001). `price_at_rec` comes from the quote map, never from the
 * reply. Versions are stamped from the caller's context, never from the
 * model's text — a model that claims a prompt version is not evidence of one.
 */
export function decisionInsert(d: StructuredDecision, stamp: DecisionStamp): Insert<"decisions"> {
  const readinessLine = readinessRiskLine(stamp.verdict);
  const keyRisks = readinessLine ? [readinessLine, ...d.key_risks] : d.key_risks;
  const price = d.symbol ? stamp.quotes[d.symbol]?.price : undefined;
  return {
    user_id: stamp.userId,
    decided_on: stamp.today,
    review_type: REVIEW_TYPE[stamp.meeting],
    symbol: d.symbol,
    action: d.action,
    recommendation: d.recommendation,
    decision: "pending",
    confidence: d.confidence,
    evidence: d.evidence,
    counterargument: d.counterargument,
    key_risks: keyRisks,
    invalidation_conditions: d.invalidation_conditions,
    price_at_rec: typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null,
    goal_version_id: stamp.goalVersionId,
    ips_version: stamp.ipsVersion,
    model_version: stamp.modelVersion,
    prompt_version: stamp.promptVersion,
  };
}

/** Every decision from a run, or nothing — a run is recorded whole or not at all. */
export function decisionInserts(
  decisions: readonly StructuredDecision[],
  stamp: DecisionStamp,
): Insert<"decisions">[] {
  if (!mayRecord(stamp.verdict)) return [];
  return decisions.map((d) => decisionInsert(d, stamp));
}
