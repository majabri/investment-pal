// §15.5 relevance scoring, with the held set as an INPUT rather than a literal.
import { describe, expect, test } from "bun:test";

import {
  HELD_POINTS,
  RECENCY_FLOOR,
  TIER_1_POINTS,
  TIER_2_POINTS,
  heldPattern,
  recencyPoints,
  scoreHeadline,
} from "@/lib/newsRelevance";

describe("recencyPoints", () => {
  test("NEGATIVE CONTROL: fresher is worth more", () => {
    expect(recencyPoints(0.5)).toBeGreaterThan(recencyPoints(5));
    expect(recencyPoints(5)).toBeGreaterThan(recencyPoints(30));
  });

  test("unknown age is OLD, never fresh", () => {
    // A headline with no timestamp must not float to the top as if it broke
    // a minute ago.
    expect(recencyPoints(null)).toBe(RECENCY_FLOOR);
    expect(recencyPoints(Number.NaN)).toBe(RECENCY_FLOOR);
  });
});

describe("heldPattern", () => {
  test("no symbols is NULL — not a pattern that matches nothing, and not anyone's list", () => {
    expect(heldPattern([])).toBeNull();
    expect(heldPattern(["", "  "])).toBeNull();
  });

  test("NEGATIVE CONTROL: a held symbol matches as a whole word", () => {
    const p = heldPattern(["AAA", "BBB"])!;
    expect(p.test("AAA jumps on earnings")).toBe(true);
    expect(p.test("Analysts upgrade BBB")).toBe(true);
  });

  test("a symbol inside a longer token does not match", () => {
    const p = heldPattern(["AAA"])!;
    expect(p.test("AAAA reports")).toBe(false);
    expect(p.test("XAAA reports")).toBe(false);
    expect(p.test("AAA1 reports")).toBe(false);
  });

  test("a dotted symbol is escaped — the dot is a dot", () => {
    // Unescaped, `BRK.B` would also match `BRKxB` and `BRK B`.
    const p = heldPattern(["ZZZ.B"])!;
    expect(p.test("ZZZ.B rallies")).toBe(true);
    expect(p.test("ZZZxB rallies")).toBe(false);
  });

  test("case matters: a lowercase word is not the ticker", () => {
    const p = heldPattern(["META"])!;
    expect(p.test("META beats")).toBe(true);
    expect(p.test("the meta of the market")).toBe(false);
  });

  test("symbols are normalised and de-duplicated", () => {
    const p = heldPattern([" aaa ", "AAA", "aaa"])!;
    expect(p.source.split("|")).toHaveLength(1);
    expect(p.test("AAA up")).toBe(true);
  });
});

describe("scoreHeadline", () => {
  const held = heldPattern(["AAA"]);

  test("NEGATIVE CONTROL: a held-name headline outscores the same headline unheld", () => {
    const t = "AAA guidance raised";
    expect(scoreHeadline(t, 2, held) - scoreHeadline(t, 2, null)).toBe(HELD_POINTS);
  });

  test("no held pattern contributes nothing — there is no fallback list", () => {
    // The original defect: with no caller-supplied set, fourteen literal
    // tickers were used. Now the bonus is exactly zero.
    const t = "AAA guidance raised";
    expect(scoreHeadline(t, 2, null)).toBe(recencyPoints(2) + TIER_2_POINTS);
  });

  test("tier 1 vocabulary outranks tier 2, and only one tier applies", () => {
    expect(scoreHeadline("Fed signals rate cut", 2, null)).toBe(recencyPoints(2) + TIER_1_POINTS);
    expect(scoreHeadline("Earnings beat", 2, null)).toBe(recencyPoints(2) + TIER_2_POINTS);
    // A headline with both tiers gets tier 1 only, never the sum.
    expect(scoreHeadline("Fed reacts to earnings", 2, null)).toBe(recencyPoints(2) + TIER_1_POINTS);
  });

  test("the components add: recency + tier + held", () => {
    expect(scoreHeadline("AAA crash", 0.5, held)).toBe(40 + TIER_1_POINTS + HELD_POINTS);
  });
});
