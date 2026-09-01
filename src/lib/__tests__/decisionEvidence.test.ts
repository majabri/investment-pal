// Gap G2: the evidence contract has been written since PR #63 and read by
// nothing. These pin the parsing rules the card depends on — especially that
// nothing is invented and that confidence is never treated as a probability.
import { describe, expect, test } from "bun:test";

import {
  formatConfidence,
  parseEvidence,
  parseImpact,
  parseStringList,
  readDecisionEvidence,
} from "../decisionEvidence";

describe("parseEvidence — both contract shapes", () => {
  // OD-008: one certified schema says [{source_id, claim}], the other string[].
  // Accepting both is correct under either outcome.
  test("reads the object shape and keeps the source", () => {
    expect(parseEvidence([{ source_id: "10-Q p4", claim: "FCF up 18% YoY" }])).toEqual([
      { claim: "FCF up 18% YoY", source: "10-Q p4" },
    ]);
  });

  test("reads the plain-string shape", () => {
    expect(parseEvidence(["FCF up 18% YoY"])).toEqual([{ claim: "FCF up 18% YoY" }]);
  });

  test("accepts either spelling of the source key", () => {
    expect(parseEvidence([{ source: "Stooq", claim: "50d MA crossed" }])[0].source).toBe("Stooq");
  });

  test("never fabricates a source when none was recorded", () => {
    expect(parseEvidence(["unsourced claim"])[0].source).toBeUndefined();
  });

  test("drops entries with no claim text rather than rendering a blank bullet", () => {
    expect(parseEvidence([{ source_id: "x" }, { claim: "   " }, "", "real"])).toEqual([
      { claim: "real" },
    ]);
  });

  test("returns nothing for null, undefined and junk", () => {
    for (const v of [null, undefined, 42, {}, true]) {
      expect(parseEvidence(v)).toEqual([]);
    }
  });

  test("parses a JSON string payload", () => {
    expect(parseEvidence('[{"claim":"a","source_id":"s"}]')).toEqual([{ claim: "a", source: "s" }]);
  });
});

describe("parseStringList", () => {
  test("keeps order and trims", () => {
    expect(parseStringList([" concentration ", "rate risk"])).toEqual([
      "concentration",
      "rate risk",
    ]);
  });

  test("tolerates objects and drops empties", () => {
    expect(parseStringList([{ risk: "liquidity" }, "", null, { nope: 1 }])).toEqual(["liquidity"]);
  });

  test("null yields an empty list, not a placeholder", () => {
    expect(parseStringList(null)).toEqual([]);
  });
});

describe("parseImpact", () => {
  test("humanises keys and keeps values", () => {
    expect(parseImpact({ equity_pct: "+2.1", sector: "Tech" })).toEqual([
      { label: "Equity pct", value: "+2.1" },
      { label: "Sector", value: "Tech" },
    ]);
  });

  test("keeps numeric and boolean values rather than dropping them", () => {
    expect(parseImpact({ delta: 0, breaches_cap: false })).toEqual([
      { label: "Delta", value: "0" },
      { label: "Breaches cap", value: "false" },
    ]);
  });

  test("stringifies nested values instead of losing them", () => {
    expect(parseImpact({ by_sector: { tech: 2 } })[0].value).toBe('{"tech":2}');
  });

  test("empty for null", () => {
    expect(parseImpact(null)).toEqual([]);
  });

  // JSON.stringify(null) is the truthy string "null", so an unguarded array
  // branch renders the literal word "null" as an impact value.
  test("null and undefined inside an array are absent, not the word null", () => {
    expect(parseImpact([null, undefined, "kept"])).toEqual([{ label: "", value: "kept" }]);
  });

  test("array and object branches agree on what counts as absent", () => {
    expect(parseImpact([null])).toEqual(parseImpact({ a: null }));
    expect(parseImpact([""])).toEqual(parseImpact({ a: "" }));
  });

  test("zero and false survive in arrays as they do in objects", () => {
    expect(parseImpact([0, false])).toEqual([
      { label: "", value: "0" },
      { label: "", value: "false" },
    ]);
  });
});

describe("formatConfidence — confidence is not a probability", () => {
  test("renders the fraction as a percentage", () => {
    expect(formatConfidence(0.72)).toBe("72%");
    expect(formatConfidence(0)).toBe("0%");
    expect(formatConfidence(1)).toBe("100%");
  });

  test("rejects out-of-range values instead of clamping", () => {
    // The column has a CHECK for [0,1]; a 4.2 means the data is wrong, and
    // showing "100%" would hide that.
    expect(formatConfidence(4.2)).toBeNull();
    expect(formatConfidence(-0.1)).toBeNull();
  });

  test("null for missing or non-numeric", () => {
    expect(formatConfidence(null)).toBeNull();
    expect(formatConfidence(undefined)).toBeNull();
    expect(formatConfidence("high")).toBeNull();
  });
});

describe("readDecisionEvidence", () => {
  test("a row predating the contract reports nothing recorded", () => {
    const ev = readDecisionEvidence({});
    expect(ev.hasAny).toBe(false);
    expect(ev.evidence).toEqual([]);
    expect(ev.confidence).toBeNull();
    expect(ev.counterargument).toBeNull();
  });

  test("a single populated field is enough to have content", () => {
    expect(readDecisionEvidence({ counterargument: "Multiple already rich" }).hasAny).toBe(true);
  });

  test("confidence and probability_impact stay separate fields", () => {
    const ev = readDecisionEvidence({
      confidence: 0.6,
      probability_impact: { objective_delta: "+3pp" },
    });
    expect(ev.confidence).toBe("60%");
    expect(ev.probabilityImpact).toEqual([{ label: "Objective delta", value: "+3pp" }]);
    // Nothing merges them into one figure.
    expect(JSON.stringify(ev.probabilityImpact)).not.toContain("60%");
  });

  test("all eight contract fields are surfaced", () => {
    const ev = readDecisionEvidence({
      action: "TRIM",
      confidence: 0.8,
      evidence: [{ claim: "c", source_id: "s" }],
      counterargument: "bear case",
      key_risks: ["risk"],
      portfolio_impact: { equity_pct: "-1" },
      probability_impact: { delta: "+1pp" },
      invalidation_conditions: ["breaks 200d"],
    });
    expect(ev.action).toBe("TRIM");
    expect(ev.confidence).toBe("80%");
    expect(ev.evidence).toHaveLength(1);
    expect(ev.counterargument).toBe("bear case");
    expect(ev.keyRisks).toEqual(["risk"]);
    expect(ev.portfolioImpact).toHaveLength(1);
    expect(ev.probabilityImpact).toHaveLength(1);
    expect(ev.invalidationConditions).toEqual(["breaks 200d"]);
    expect(ev.hasAny).toBe(true);
  });
});
