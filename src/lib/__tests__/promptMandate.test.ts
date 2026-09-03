// The committee mandate must come from the user's goal, not from a literal
// baked into the prompt templates (PR-UI-2). Before this, editing your goal
// changed every screen except the prompt the model actually reads.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

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

// ── Stage 4: one objective, one row ──────────────────────────────────────────
//
// The objective was editable in two places that were not the same place. The
// goal screen wrote `goals`, which the dashboard, the goal screen and the
// committee prompt all read. The per-account form in Settings wrote
// `accounts.target_value` / `target_date` / `starting_value`, which NOTHING
// read — so setting a target there looked like setting a target and set
// nothing, and the two could disagree indefinitely without any screen noticing.

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

describe("the objective has exactly one home", () => {
  // Generated Supabase types and the Account row type must still describe the
  // deprecated columns — the data is still there. What must not exist is code
  // that WRITES them, which is what re-creates the second objective.
  const EXEMPT = ["src/integrations/supabase/types.ts", "src/hooks/useAppData.ts"];

  test("nothing writes an objective onto an account any more", () => {
    const offenders: string[] = [];
    for (const file of productionSources()) {
      if (EXEMPT.some((e) => file.replace(/\\/g, "/").endsWith(e))) continue;
      const code = stripComments(readFileSync(file, "utf8"));
      // A write looks like `target_value:` in an object literal. A read looks
      // like `account.target_value`. Only the write re-opens the divergence.
      for (const field of ["target_value", "target_date", "starting_value"]) {
        const write = new RegExp(`(^|[^.\\w])${field}\\s*:`, "m");
        if (write.test(code)) offenders.push(`${file} writes ${field}`);
      }
    }
    // goals.tsx and settings.tsx both write these — to the GOAL row, through
    // `useGoal().update`. That is the single home, so they are named here
    // rather than exempted silently: if a third file appears, this fails.
    const allowed = new Set([
      "src/routes/_authenticated/goals.tsx writes target_value",
      "src/routes/_authenticated/goals.tsx writes target_date",
      "src/routes/_authenticated/goals.tsx writes starting_value",
      "src/routes/_authenticated/settings.tsx writes target_value",
      "src/routes/_authenticated/settings.tsx writes target_date",
      "src/routes/_authenticated/settings.tsx writes starting_value",
    ]);
    expect(offenders.filter((o) => !allowed.has(o.replace(/\\/g, "/")))).toEqual([]);
  });

  test("both objective editors reach the goal row through useGoal", () => {
    // Necessary, not sufficient — a file could call `useGoal` and still write
    // an objective elsewhere. The sufficient half is the writer allow-list
    // above; this pins that each permitted writer has the goal hook to write
    // through at all.
    for (const file of [
      "src/routes/_authenticated/goals.tsx",
      "src/routes/_authenticated/settings.tsx",
    ]) {
      expect(readFileSync(file, "utf8")).toContain("useGoal");
    }
  });

  test("the goal screen never touches the accounts table", () => {
    // Settings legitimately does — it manages accounts. The goal screen has no
    // business there, and if it acquired one that would be the second
    // objective growing back.
    const code = stripComments(readFileSync("src/routes/_authenticated/goals.tsx", "utf8"));
    expect(code).not.toContain('from("accounts")');
    expect(code).not.toContain("useAccounts");
  });

  test("the mandate the committee reads comes from the goal, not an account", () => {
    // Restated as behaviour rather than as source-shape: change the objective
    // and the prompt changes with it.
    const before = mandateOf(ctx());
    const after = mandateOf(ctx({ goalTarget: 400_000, goalDate: "2032-01-31" }));
    expect(before.target).not.toBe(after.target);
    expect(after.target).toBe("$400,000");
    expect(after.date).toBe("January 31, 2032");
  });
});
