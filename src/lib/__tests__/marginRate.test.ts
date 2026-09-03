// OD-009: the margin rate was a constant copy-pasted into ten places across
// three files, the values disagreed, and Amir confirmed on 2026-09-03 that all
// of them are now out of date. These tests pin the two properties that matter:
// the app never states a rate it does not have, and no eleventh copy can appear
// without the suite going red.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  MARGIN_RATE,
  marginRateLabel,
  marginRatePromptLine,
  type MarginRate,
} from "../marginRate";
import { buildV6Prompt, buildWeeklyPrompt, buildUniversalPrompt, type PromptContext } from "../prompts";

const RECORDED: MarginRate = { status: "recorded", annualPct: 9.5, asOf: "2026-09-03" };

describe("marginRate", () => {
  test("ships in the not-recorded state — no rate is asserted anywhere", () => {
    // If this ever fails, someone set a rate without ADR-APP-007. That is the
    // money-adjacent sign-off gate (OD-001), not a lint nit.
    expect(MARGIN_RATE.status).toBe("not-recorded");
  });

  test("the label admits absence instead of showing a number", () => {
    expect(marginRateLabel()).toBe("rate not recorded");
    expect(marginRateLabel()).not.toMatch(/\d/);
  });

  test("the label reports the rate and its as-of date once recorded", () => {
    expect(marginRateLabel(RECORDED)).toBe("9.5% APR (verified 2026-09-03)");
  });

  test("the prompt line tells the model not to substitute a rate", () => {
    const line = marginRatePromptLine();
    expect(line).toContain("NOT RECORDED");
    // The whole point: an LLM asked about leverage with no rate will invent a
    // plausible one unless told not to (AIOS §27).
    expect(line.toLowerCase()).toContain("do not assume");
    expect(line).not.toMatch(/\d+(\.\d+)?%/);
  });

  test("the prompt line states the rate and provenance once recorded", () => {
    const line = marginRatePromptLine(RECORDED);
    expect(line).toContain("9.5% APR");
    expect(line).toContain("verified 2026-09-03");
  });
});

function ctx(): PromptContext {
  return {
    accountName: "Growth Brokerage",
    portfolioValue: 72_500,
    cash: 2_500,
    marginUsed: 0,
    buyingPower: 5_000,
    todaysPL: 0,
    todaysPLPct: 0,
    goalStartingValue: 60_000,
    goalTarget: 250_000,
    goalDate: "2030-06-30",
    requiredCagr: 0.2,
    probability: 0.4,
    holdings: [],
    priorities: [],
    userNotes: "",
  };
}

describe("committee prompts state no margin rate", () => {
  const builders: Array<[string, string]> = [
    ["v6 (live)", buildV6Prompt({ ...ctx(), meeting: "Weekly" })],
    ["weekly", buildWeeklyPrompt(ctx())],
    ["universal", buildUniversalPrompt({ ...ctx(), meeting: "Weekly" })],
  ];

  for (const [name, out] of builders) {
    test(`${name} carries neither stale figure`, () => {
      expect(out).not.toContain("11.825");
      expect(out).not.toContain("12.075");
    });

    test(`${name} still tells the committee the rate is missing`, () => {
      // Silently dropping the concept would be worse than a stale number: the
      // model would reason about leverage with no cue that the cost is unknown.
      expect(out).toContain("NOT RECORDED");
    });
  }
});

/** Every .ts/.tsx under src/, excluding tests. */
function productionSources(dir = "src"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "test") continue;
      out.push(...productionSources(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Strip comments so prose about the old constants doesn't trip the guard. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("no hardcoded margin rate survives in production source", () => {
  test("neither the percentage nor the decimal spelling appears in code", () => {
    // The tenth site was missed for a week because it was written 0.11825 while
    // the search was for 11.825. Both spellings are checked, everywhere.
    const offenders: string[] = [];
    for (const file of productionSources()) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const pattern of ["11.825", "12.075", "0.11825", "0.12075"]) {
        if (code.includes(pattern)) offenders.push(`${file} contains ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
