// From the committee's structured output to `decisions` rows, versions
// stamped (CONST-003, DEC-003, DEC-004).
//
// The contract required `ips_version`, `model_version` and `prompt_version`
// and nothing wrote them. This is where they are written from.
import { describe, expect, test } from "bun:test";

import type { StructuredDecision } from "@/lib/committeeContract";
import {
  READINESS_RISK_PREFIX,
  decisionInsert,
  decisionInserts,
  ipsVersionOf,
  mayRecord,
  readinessRiskLine,
} from "@/lib/committeeDecisions";
import type { DecisionStamp, PolicyLike } from "@/lib/committeeDecisions";
import { MARGIN_POLICY_UNSET } from "@/lib/marginCost";
import type { ReadinessCheck } from "@/lib/readiness";
import type { GateVerdict } from "@/lib/readinessGate";

const ips: PolicyLike = {
  position_cap_pct: 30,
  position_cap_hard: false,
  margin_cap_pct: 25,
  caps_source: "user_set",
  ...MARGIN_POLICY_UNSET,
};

const check = (id: ReadinessCheck["id"], label: string): ReadinessCheck => ({
  id,
  label,
  state: "fail",
  detail: "not verified",
});

const READY: GateVerdict = { state: "READY", blocking: [], degrading: [] };
const DEGRADED: GateVerdict = { state: "DEGRADED", blocking: [], degrading: [check("quotes", "Quotes")] };
const BLOCKED: GateVerdict = { state: "BLOCKED", blocking: [check("positions", "Positions")], degrading: [] };
const ERROR: GateVerdict = { state: "ERROR", blocking: [], degrading: [] };

const d = (over: Partial<StructuredDecision> = {}): StructuredDecision => ({
  action: "REDUCE",
  symbol: "AAA",
  recommendation: "Trim a quarter.",
  confidence: 0.7,
  evidence: ["36% of net equity"],
  counterargument: null,
  key_risks: ["Earnings soon"],
  invalidation_conditions: ["New high on volume"],
  ...over,
});

const stamp = (over: Partial<DecisionStamp> = {}): DecisionStamp => ({
  userId: "u1",
  today: "2026-09-17",
  meeting: "Morning",
  goalVersionId: "gv-1",
  ipsVersion: ipsVersionOf(ips),
  modelVersion: "gpt-4o-2026-01-01",
  promptVersion: "os-v6.0",
  verdict: READY,
  quotes: { AAA: { price: 123.45 } },
  ...over,
});

describe("ipsVersionOf", () => {
  test("NEGATIVE CONTROL: deterministic for the same policy", () => {
    expect(ipsVersionOf(ips)).toBe(ipsVersionOf({ ...ips }));
  });

  test("readable: says the caps, the margin cap and the source", () => {
    const v = ipsVersionOf(ips);
    expect(v).toContain("user_set");
    expect(v).toContain("cap30s");
    expect(v).toContain("mgn25");
  });

  test("changes when any policy value changes", () => {
    const base = ipsVersionOf(ips);
    expect(ipsVersionOf({ ...ips, position_cap_pct: 25 })).not.toBe(base);
    expect(ipsVersionOf({ ...ips, position_cap_hard: true })).not.toBe(base);
    expect(ipsVersionOf({ ...ips, margin_cap_pct: 20 })).not.toBe(base);
    expect(ipsVersionOf({ ...ips, caps_source: "default" })).not.toBe(base);
  });

  test("an unset margin rate is named as unset, not as zero", () => {
    expect(ipsVersionOf(ips)).toContain("rate-unset");
    const set = { ...ips, margin_rate_annual_pct: 9.5, margin_rate_as_of: "2026-09-01" };
    expect(ipsVersionOf(set)).toContain("rate9.5@2026-09-01");
  });
});

describe("mayRecord", () => {
  test("READY and DEGRADED may be recorded", () => {
    expect(mayRecord(READY)).toBe(true);
    expect(mayRecord(DEGRADED)).toBe(true);
  });

  test("BLOCKED and ERROR may not — DEC-004", () => {
    expect(mayRecord(BLOCKED)).toBe(false);
    expect(mayRecord(ERROR)).toBe(false);
  });
});

describe("readinessRiskLine", () => {
  test("NEGATIVE CONTROL: READY has no line", () => {
    expect(readinessRiskLine(READY)).toBeNull();
  });

  test("DEGRADED becomes a prefixed line carrying the gate's caveat", () => {
    const line = readinessRiskLine(DEGRADED)!;
    expect(line.startsWith(READINESS_RISK_PREFIX)).toBe(true);
    expect(line).toContain("DEGRADED");
    expect(line).toContain("quotes");
  });
});

describe("decisionInsert", () => {
  test("NEGATIVE CONTROL: a decision becomes a pending row with every stamp", () => {
    const row = decisionInsert(d(), stamp());
    expect(row.decision).toBe("pending");
    expect(row.review_type).toBe("morning_review");
    expect(row.symbol).toBe("AAA");
    expect(row.action).toBe("REDUCE");
    expect(row.goal_version_id).toBe("gv-1");
    expect(row.ips_version).toBe(ipsVersionOf(ips));
    expect(row.model_version).toBe("gpt-4o-2026-01-01");
    expect(row.prompt_version).toBe("os-v6.0");
    expect(row.decided_on).toBe("2026-09-17");
  });

  test("price_at_rec comes from the quote map, never from the decision", () => {
    expect(decisionInsert(d(), stamp()).price_at_rec).toBe(123.45);
    expect(decisionInsert(d(), stamp({ quotes: {} })).price_at_rec).toBeNull();
    expect(decisionInsert(d({ symbol: null }), stamp()).price_at_rec).toBeNull();
  });

  test("an unusable quote is null, not zero", () => {
    expect(decisionInsert(d(), stamp({ quotes: { AAA: { price: 0 } } })).price_at_rec).toBeNull();
    expect(decisionInsert(d(), stamp({ quotes: { AAA: { price: Number.NaN } } })).price_at_rec).toBeNull();
  });

  test("a DEGRADED run puts the readiness caveat FIRST among the key risks", () => {
    const row = decisionInsert(d(), stamp({ verdict: DEGRADED }));
    const risks = row.key_risks as string[];
    expect(risks[0].startsWith(READINESS_RISK_PREFIX)).toBe(true);
    expect(risks[1]).toBe("Earnings soon");
  });

  test("a READY run adds no readiness line", () => {
    expect(decisionInsert(d(), stamp()).key_risks).toEqual(["Earnings soon"]);
  });

  test("a null model version is stored as null — not as a guess", () => {
    expect(decisionInsert(d(), stamp({ modelVersion: null })).model_version).toBeNull();
  });

  test("the meeting type maps to the review type", () => {
    expect(decisionInsert(d(), stamp({ meeting: "Evening" })).review_type).toBe("eod_review");
    expect(decisionInsert(d(), stamp({ meeting: "Weekly" })).review_type).toBe("weekly_review");
  });
});

describe("decisionInserts", () => {
  test("NEGATIVE CONTROL: every decision becomes a row", () => {
    expect(decisionInserts([d(), d({ symbol: "BBB" })], stamp())).toHaveLength(2);
  });

  test("a BLOCKED run records NOTHING — whole or not at all", () => {
    expect(decisionInserts([d(), d({ symbol: "BBB" })], stamp({ verdict: BLOCKED }))).toEqual([]);
    expect(decisionInserts([d()], stamp({ verdict: ERROR }))).toEqual([]);
  });
});
