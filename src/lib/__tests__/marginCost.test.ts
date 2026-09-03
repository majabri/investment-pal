// ADR-APP-007. The rate was a constant in two places — `(marginUsed * 0.11825)
// / 365` on the dashboard and "Owed to Fidelity at 11.825% APR" on MarginCard.
// They agreed by coincidence and nothing kept them agreeing.
//
// The rule these tests exist to enforce: an unset rate SUPPRESSES the cost
// figure. Never zero, never a previous value, never a plausible default. A
// missing rate that silently computes as zero makes leverage look free, right
// beside the cap meant to limit leverage.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  MARGIN_POLICY_UNSET,
  annualMarginInterest,
  dailyMarginInterest,
  marginRateLabel,
  marginRatePromptLine,
  rateStatus,
  type MarginPolicy,
} from "../marginCost";
import { buildV6Prompt, mandateOf, type PromptContext } from "../prompts";

const SET: MarginPolicy = {
  margin_rate_annual_pct: 10,
  margin_rate_as_of: "2026-09-01",
  margin_rate_is_floating: true,
  margin_rate_stale_days: 30,
};

describe("unset rate suppresses rather than zeroes", () => {
  test("daily interest is null, not 0", () => {
    // The whole point. `0` would render as "$0.00/day interest" — a confident
    // claim that borrowing is free.
    expect(dailyMarginInterest(25_000, MARGIN_POLICY_UNSET)).toBeNull();
  });

  test("annual interest is null, not 0", () => {
    expect(annualMarginInterest(25_000, MARGIN_POLICY_UNSET)).toBeNull();
  });

  test("the label says so instead of showing a figure", () => {
    expect(marginRateLabel(MARGIN_POLICY_UNSET)).toBe("Margin rate not set");
    expect(marginRateLabel(MARGIN_POLICY_UNSET)).not.toMatch(/\d/);
  });

  test("the status is unset", () => {
    expect(rateStatus(MARGIN_POLICY_UNSET).kind).toBe("unset");
  });
});

describe("computation once the rate is set", () => {
  test("daily interest divides the annual rate by 365", () => {
    // 25,000 at 10% = 2,500/yr = 6.8493…/day
    expect(dailyMarginInterest(25_000, SET)!).toBeCloseTo(2_500 / 365, 10);
  });

  test("annual interest round-trips", () => {
    expect(annualMarginInterest(25_000, SET)!).toBeCloseTo(2_500, 8);
  });

  test("the rate is read as a percentage, not a fraction", () => {
    // Reading 10 as 1000% is the obvious way to get this catastrophically wrong.
    expect(annualMarginInterest(100, SET)!).toBeCloseTo(10, 10);
  });

  test("no balance means no interest — that zero is real", () => {
    expect(dailyMarginInterest(0, SET)).toBe(0);
  });
});

describe("staleness", () => {
  const now = new Date("2026-09-03T00:00:00Z");

  test("within the threshold is current", () => {
    expect(rateStatus(SET, now)).toEqual({
      kind: "current",
      asOf: "2026-09-01",
      ageDays: 2,
    });
  });

  test("past the threshold is stale, with its age", () => {
    const old = { ...SET, margin_rate_as_of: "2026-07-01" };
    const s = rateStatus(old, now);
    expect(s.kind).toBe("stale");
    expect(s.kind === "stale" && s.ageDays).toBe(64);
  });

  test("the threshold is configurable, not baked in", () => {
    const old = { ...SET, margin_rate_as_of: "2026-07-01", margin_rate_stale_days: 90 };
    expect(rateStatus(old, now).kind).toBe("current");
  });

  test("a rate with no date is unverified, not assumed fresh", () => {
    expect(rateStatus({ ...SET, margin_rate_as_of: null }, now).kind).toBe("unverified");
  });

  test("a malformed date is unverified rather than a NaN age", () => {
    expect(rateStatus({ ...SET, margin_rate_as_of: "not-a-date" }, now).kind).toBe("unverified");
  });
});

describe("what the committee is told", () => {
  test("an unset rate tells the model not to substitute one", () => {
    const line = marginRatePromptLine(MARGIN_POLICY_UNSET);
    expect(line).toContain("NOT SET");
    expect(line.toLowerCase()).toContain("do not assume");
    // Crucially, no number at all — an LLM will anchor on any it is given.
    expect(line).not.toMatch(/\d+(\.\d+)?%/);
  });

  test("a set rate is stated with its provenance", () => {
    const line = marginRatePromptLine(SET);
    expect(line).toContain("10% APR");
    expect(line).toContain("floating");
    expect(line).toContain("verified 2026-09-01");
  });

  test("a malformed date is never echoed as a verification claim", () => {
    // Post-merge Copilot finding: the line read "verified not-a-date", handing
    // the committee provenance the data does not support (AIOS §27).
    const line = marginRatePromptLine({ ...SET, margin_rate_as_of: "not-a-date" });
    expect(line).not.toContain("verified not-a-date");
    expect(line).toContain("verification date not recorded");
  });

  test("a missing date says so rather than claiming verification", () => {
    const line = marginRatePromptLine({ ...SET, margin_rate_as_of: null });
    expect(line).toContain("verification date not recorded");
  });

  test("a stale rate is flagged to the model, not passed off as current", () => {
    const line = marginRatePromptLine({ ...SET, margin_rate_as_of: "2026-01-01" });
    expect(line.toLowerCase()).toContain("may be out of date");
  });
});

function ctx(overrides: Partial<PromptContext> = {}): PromptContext {
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
    ...overrides,
  };
}

describe("committee prompts carry no baked-in rate", () => {
  test("the live prompt says NOT SET when no policy is supplied", () => {
    const out = buildV6Prompt({ ...ctx(), meeting: "Weekly" });
    expect(out).toContain("NOT SET");
    expect(out).not.toContain("11.825");
    expect(out).not.toContain("12.075");
  });

  test("the live prompt carries the stored rate when one is set", () => {
    const out = buildV6Prompt({ ...ctx({ marginPolicy: SET }), meeting: "Weekly" });
    expect(out).toContain("10% APR");
    expect(out).not.toContain("NOT SET");
  });

  test("the mandate exposes the rate sentence rather than a bare number", () => {
    expect(mandateOf(ctx()).marginRate).toContain("NOT SET");
  });
});

function productionSources(dir = "src"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "test") continue;
      out.push(...productionSources(full));
    } else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("no margin rate survives anywhere in production source", () => {
  test("neither the percentage nor the decimal spelling appears in code", () => {
    // The decimal form is why the dashboard site went unnoticed: the search was
    // for "11.825" and the code said "0.11825". Both spellings, everywhere.
    const offenders: string[] = [];
    for (const file of productionSources()) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const pattern of ["11.825", "12.075", "0.11825", "0.12075"]) {
        if (code.includes(pattern)) offenders.push(`${file} contains ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the shipped policy default leaves the rate unset", () => {
    // If this fails, someone gave the rate a default — the one thing
    // ADR-APP-007 forbids.
    expect(MARGIN_POLICY_UNSET.margin_rate_annual_pct).toBeNull();
    expect(MARGIN_POLICY_UNSET.margin_rate_as_of).toBeNull();
  });

  test("the migration supplies no DEFAULT for the rate", () => {
    const sql = readFileSync(
      "supabase/migrations/20260903020000_ips_lite_margin_rate.sql",
      "utf8",
    );
    expect(sql).toMatch(/margin_rate_annual_pct\s+NUMERIC\s*,/);
    expect(sql).not.toMatch(/margin_rate_annual_pct\s+NUMERIC[^,]*DEFAULT/);
  });
});
