// The committee's structured reply, refused or accepted whole (DEC-001, DEC-002).
import { describe, expect, test } from "bun:test";

import {
  EXTRACTION_INSTRUCTION,
  PROMPT_VERSION,
  parseCommitteeJson,
} from "@/lib/committeeContract";
import { RECOMMENDATION_ACTIONS } from "@/lib/decisionEvidence";

const good = {
  decisions: [
    {
      action: "TRIM",
      symbol: "AAA",
      recommendation: "Trim a quarter into strength; concentration above cap.",
      confidence: 0.7,
      evidence: ["36% of net equity against a 30% cap", "RSI14 above 75"],
      counterargument: "Momentum may continue into earnings.",
      key_risks: ["Earnings in four sessions"],
      invalidation_conditions: ["Close above the prior high on volume"],
    },
  ],
  cio_summary: "One trim, otherwise hold.",
};

describe("parseCommitteeJson", () => {
  test("NEGATIVE CONTROL: clean JSON parses", () => {
    const r = parseCommitteeJson(JSON.stringify(good));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output.decisions[0].action).toBe("TRIM");
  });

  test("a code fence is tolerated — models add them despite being told not to", () => {
    const r = parseCommitteeJson("```json\n" + JSON.stringify(good) + "\n```");
    expect(r.ok).toBe(true);
  });

  test("a prefacing sentence is tolerated", () => {
    const r = parseCommitteeJson("Here is the action sheet as JSON:\n" + JSON.stringify(good));
    expect(r.ok).toBe(true);
  });

  test("no JSON object at all is refused with a reason", () => {
    const r = parseCommitteeJson("I recommend trimming AAA.");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("no JSON");
  });

  test("broken JSON is refused with a reason", () => {
    const r = parseCommitteeJson('{"decisions": [}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("not valid JSON");
  });

  test("a confidence outside 0–1 is refused, and the path is named", () => {
    const bad = { decisions: [{ ...good.decisions[0], confidence: 70 }] };
    const r = parseCommitteeJson(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("decisions.0.confidence");
  });

  test("one bad entry refuses the WHOLE list — never a shorter list", () => {
    // A decision list with one bad entry silently trimmed would look like a
    // review that recommended less than it did.
    const bad = { decisions: [good.decisions[0], { ...good.decisions[0], recommendation: "" }] };
    const r = parseCommitteeJson(JSON.stringify(bad));
    expect(r.ok).toBe(false);
  });

  test("an empty decision list is refused — no action is a HOLD, not nothing", () => {
    const r = parseCommitteeJson(JSON.stringify({ decisions: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("HOLD");
  });

  test("symbol and action are normalised to uppercase; a null symbol is kept", () => {
    const mixed = {
      decisions: [{ ...good.decisions[0], action: "trim", symbol: "aaa" }, { ...good.decisions[0], symbol: null, action: "HOLD" }],
    };
    const r = parseCommitteeJson(JSON.stringify(mixed));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output.decisions[0].action).toBe("TRIM");
      expect(r.output.decisions[0].symbol).toBe("AAA");
      expect(r.output.decisions[1].symbol).toBeNull();
    }
  });

  test("a null confidence is kept as null — never defaulted", () => {
    const r = parseCommitteeJson(JSON.stringify({ decisions: [{ ...good.decisions[0], confidence: null }] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output.decisions[0].confidence).toBeNull();
  });

  test("an off-contract verb from the MODEL is refused, never renamed and never written", () => {
    // Two different rules meet here. decisionEvidence never renames a
    // governed decision already stored; this parser never lets a new one be
    // stored under a word the contract does not have (ADR-APP-008 Am. 1).
    const r = parseCommitteeJson(JSON.stringify({ decisions: [{ ...good.decisions[0], action: "MARGIN" }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("MARGIN");
  });
});

describe("EXTRACTION_INSTRUCTION", () => {
  test("names every contract verb, so the model does not have to guess", () => {
    for (const a of RECOMMENDATION_ACTIONS) expect(EXTRACTION_INSTRUCTION).toContain(a);
  });

  test("asks for JSON only and says what no-action looks like", () => {
    expect(EXTRACTION_INSTRUCTION).toContain("no code fences");
    expect(EXTRACTION_INSTRUCTION).toContain("never an empty list");
  });

  test("tells the model not to invent a confidence", () => {
    expect(EXTRACTION_INSTRUCTION).toContain("Do not invent one");
  });
});

describe("PROMPT_VERSION", () => {
  test("is the v6 template's version", () => {
    expect(PROMPT_VERSION).toBe("os-v6.0");
  });
});

describe("the verb is the contract's (ADR-APP-008 Amendment 1)", () => {
  const withAction = (action: string) =>
    JSON.stringify({
      decisions: [{ action, symbol: "SYMA", recommendation: "x", confidence: null, evidence: [], counterargument: null, key_risks: [], invalidation_conditions: [] }],
      cio_summary: null,
    });
  test("a pre-amendment word is refused by name — the model was given the list", () => {
    const r = parseCommitteeJson(withAction("REDUCE"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("decisions.0.action");
      expect(r.reason).toContain("TRIM");
    }
  });
  test("an invented word is refused the same way", () => {
    expect(parseCommitteeJson(withAction("MARGIN")).ok).toBe(false);
  });
  test("negative control: every contract verb is accepted, case-insensitively", () => {
    for (const a of RECOMMENDATION_ACTIONS) {
      const r = parseCommitteeJson(withAction(a.toLowerCase()));
      expect([a, r.ok]).toEqual([a, true]);
    }
  });
});
