// The committee mandate must come from the user's goal, not from a literal
// baked into the prompt templates (PR-UI-2). Before this, editing your goal
// changed every screen except the prompt the model actually reads.
import { describe, expect, test } from "bun:test";

import {
  buildV6Prompt,
  buildMorningPrompt,
  buildEODPrompt,
  buildWeeklyPrompt,
  buildMiddayPrompt,
  buildUniversalPrompt,
  buildV5Prompt,
  mandateOf,
  type PromptContext,
} from "../prompts";

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

describe("mandateOf", () => {
  test("renders the objective from goal data", () => {
    const m = mandateOf(ctx());
    expect(m.account).toBe("Growth Brokerage");
    expect(m.start).toBe("$60,000");
    expect(m.target).toBe("$250,000");
    expect(m.date).toBe("June 30, 2030");
  });

  test("formats the target date in UTC", () => {
    // A bare YYYY-MM-DD parses to UTC midnight. Formatting in local time would
    // render this as March 30 for any negative-offset timezone.
    expect(mandateOf(ctx({ goalDate: "2027-03-31" })).date).toBe("March 31, 2027");
  });

  test("falls back to neutral wording rather than a name when unset", () => {
    expect(mandateOf(ctx({ accountName: "   " })).account).toBe("this portfolio");
  });

  test("passes a non-date through untouched instead of rendering Invalid Date", () => {
    expect(mandateOf(ctx({ goalDate: "—" })).date).toBe("—");
  });
});

describe("committee prompts are data-driven", () => {
  const builders: Array<[string, (c: PromptContext) => string]> = [
    ["v6", (c) => buildV6Prompt({ ...c, meeting: "Morning" })],
    ["v5", (c) => buildV5Prompt({ ...c, meeting: "Morning" })],
    ["universal", (c) => buildUniversalPrompt({ ...c, meeting: "Morning" })],
    ["morning", buildMorningPrompt],
    ["eod", (c) => buildEODPrompt({ ...c, tradesToday: "(none)" })],
    ["weekly", buildWeeklyPrompt],
    ["midday", buildMiddayPrompt],
  ];

  for (const [name, build] of builders) {
    test(`${name}: renders the goal's objective`, () => {
      const out = build(ctx());
      expect(out).toContain("$250,000");
      expect(out).toContain("June 30, 2030");
      expect(out).toContain("Growth Brokerage");
    });

    test(`${name}: contains no hardcoded objective`, () => {
      const out = build(ctx());
      // The previously baked-in mandate. Any recurrence means a template
      // stopped reading from data.
      expect(out).not.toContain("Amir-TOD");
      expect(out).not.toContain("$150,000");
      expect(out).not.toContain("$50,000");
      expect(out).not.toContain("March 31, 2027");
    });

    test(`${name}: a changed goal changes the prompt`, () => {
      const before = build(ctx());
      const after = build(ctx({ goalTarget: 999_000, goalDate: "2031-01-15" }));
      expect(before).not.toBe(after);
      expect(after).toContain("$999,000");
      expect(after).toContain("January 15, 2031");
    });
  }
});
