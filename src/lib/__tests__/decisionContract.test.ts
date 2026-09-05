// Conformance to the canonical InvestmentRecommendation contract.
//
// OD-008 resolved 2026-09-03: the 14-field schema in `08 APIs/contracts/` is
// canonical, plus `objective_id` carried over from the superseded 10-field
// version. These tests pin two things the card cannot be allowed to drift on:
// every required field is reachable from a `decisions` row, and the two
// deliberate name divergences stay deliberate rather than becoming accidents.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  CONTRACT_COLUMN_MAP,
  RECOMMENDATION_ACTIONS,
  RECOMMENDATION_REQUIRED_FIELDS,
  parseAction,
  readDecisionEvidence,
} from "../decisionEvidence";

/** The columns `public.decisions` actually has, read from the migrations. */
function migratedColumns(): Set<string> {
  const files = [
    "supabase/migrations/20260725033346_decisions.sql",
    "supabase/migrations/20260819120000_decisions_evidence_contract.sql",
    "supabase/migrations/20260903010000_decisions_contract_conformance.sql",
  ];
  const cols = new Set<string>();
  for (const f of files) {
    const sql = readFileSync(f, "utf8");
    // CREATE TABLE column lines, then ADD COLUMN lines.
    for (const m of sql.matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)/g)) cols.add(m[1]);
    const create = sql.match(/CREATE TABLE[^(]*\(([\s\S]*?)\n\);/);
    if (create) {
      for (const line of create[1].split("\n")) {
        const m = line.trim().match(/^(\w+)\s+[A-Z]/);
        if (m) cols.add(m[1]);
      }
    }
  }
  return cols;
}

describe("decisions table satisfies the contract", () => {
  const cols = migratedColumns();

  test("the migrations really were parsed (guard against a silently empty set)", () => {
    // Without this, a broken regex would make every assertion below vacuous.
    expect(cols.size).toBeGreaterThan(10);
    expect(cols.has("key_risks")).toBe(true);
  });

  for (const field of RECOMMENDATION_REQUIRED_FIELDS) {
    test(`required field "${field}" maps to a real column`, () => {
      const column = CONTRACT_COLUMN_MAP[field] ?? field;
      expect(cols.has(column)).toBe(true);
    });
  }

  test("only the two documented divergences exist", () => {
    // If a third mapping appears, it needs an ADR entry, not a quiet addition.
    expect(Object.keys(CONTRACT_COLUMN_MAP).sort()).toEqual([
      "recommendation_id",
      "supporting_evidence",
    ]);
  });
});

describe("action enum", () => {
  test("carries exactly the contract's nine actions", () => {
    expect([...RECOMMENDATION_ACTIONS]).toEqual([
      "BUY",
      "SELL",
      "HOLD",
      "REDUCE",
      "ADD",
      "REBALANCE",
      "ROTATE",
      "WAIT",
      "ESCALATE",
    ]);
  });

  test("recognises a contract action, case-insensitively", () => {
    expect(parseAction("buy")).toEqual({ value: "BUY", inContract: true });
  });

  test("keeps an off-contract action as written rather than mapping it", () => {
    // TRIM is in the shipped migration's comment but not the contract. Silently
    // rewriting it to REDUCE would put a word on a governed decision that the
    // committee never used.
    expect(parseAction("TRIM")).toEqual({ value: "TRIM", inContract: false });
  });

  test("absent action is null, not an empty badge", () => {
    expect(parseAction(null)).toBeNull();
    expect(parseAction("   ")).toBeNull();
  });
});

describe("provenance", () => {
  test("is absent, not invented, on a pre-contract row", () => {
    const ev = readDecisionEvidence({ recommendation: "x" } as never);
    expect(ev.hasProvenance).toBe(false);
    expect(ev.provenance).toEqual({
      ipsVersion: null,
      modelVersion: null,
      promptVersion: null,
      objectiveId: null,
    });
  });

  test("reads every stamp when present", () => {
    const ev = readDecisionEvidence({
      ips_version: "ips-3",
      model_version: "m-1",
      prompt_version: "v6",
      objective_id: "obj-7",
    });
    expect(ev.hasProvenance).toBe(true);
    expect(ev.provenance.objectiveId).toBe("obj-7");
    expect(ev.provenance.ipsVersion).toBe("ips-3");
  });
});

describe("supporting_evidence keeps provenance", () => {
  test("reads the contract's {source_id, claim} shape", () => {
    const ev = readDecisionEvidence({
      evidence: [{ source_id: "10-K 2026", claim: "Backlog up 18% YoY" }],
    });
    expect(ev.evidence).toEqual([{ claim: "Backlog up 18% YoY", source: "10-K 2026" }]);
  });

  test("a legacy bare string reads as a claim with no source", () => {
    // Rows written before the contract settled. Not an invented source.
    const ev = readDecisionEvidence({ evidence: ["Margins improving"] });
    expect(ev.evidence).toEqual([{ claim: "Margins improving" }]);
  });
});
