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
  const OBJECTIVE_FIELDS = ["target_value", "target_date", "starting_value"];

  /**
   * Where a file writes to the `accounts` table.
   *
   * The naive check — "does this file mention `target_value:` anywhere?" —
   * flags every file that READS the objective into a prop or a memo, which is
   * most of the summary surface and none of the defect. The defect is
   * specifically these fields being SENT TO THE ACCOUNTS TABLE, so the guard
   * looks only at the text following an accounts write.
   */
  // Two signals, unioned, because neither alone covers every write.
  //
  // Both editors call something named `update.mutate(`, one from `useGoal` and
  // one from `useAccounts`, so the call site alone cannot tell them apart. What
  // can: the SHAPE of the payload. `account_type` and `broker` are unmistakably
  // account columns and appear in no goal write, so an objective field sharing
  // an object with either of them is an objective being written onto an
  // account — exactly what the old Settings form did.
  const ACCOUNT_SHAPE = /(^|[^.\w])(account_type|broker)\s*:/g;
  // But a direct `supabase.from("accounts").update({ ... })` need carry
  // neither key, so those call sites are scanned too. Named tables only: the
  // point is to catch a write to THIS table, not to flag every mutation.
  const ACCOUNTS_TABLE_WRITE = /\.from\(\s*["']accounts["']\s*\)[\s\S]{0,80}?\.(update|insert|upsert)\(/g;
  const WINDOW = 700;

  function accountPayloads(code: string): string[] {
    const out: string[] = [];
    for (const m of code.matchAll(ACCOUNT_SHAPE)) {
      out.push(code.slice(Math.max(0, m.index - WINDOW), m.index + WINDOW));
    }
    for (const m of code.matchAll(ACCOUNTS_TABLE_WRITE)) {
      // Forward only: the payload follows the call, and looking backwards here
      // would sweep in unrelated code above it.
      out.push(code.slice(m.index, m.index + m[0].length + WINDOW));
    }
    return out;
  }

  test("nothing sends an objective field to the accounts table", () => {
    const offenders: string[] = [];
    for (const file of productionSources()) {
      const path = file.replace(/\\/g, "/");
      // The two files that DECLARE the row shape must still describe the
      // deprecated columns — the data is still there, and a type that denied it
      // would be lying about the database. Neither constructs a payload:
      // `useAccounts().update` takes a `Partial<Account>` and passes it
      // through, so every payload is built at a call site, which is what this
      // scan covers.
      if (
        path.endsWith("src/integrations/supabase/types.ts") ||
        path.endsWith("src/hooks/useAppData.ts")
      ) {
        continue;
      }
      const code = stripComments(readFileSync(file, "utf8"));
      for (const payload of accountPayloads(code)) {
        for (const field of OBJECTIVE_FIELDS) {
          if (new RegExp(`(^|[^.\\w])${field}\\s*:`, "m").test(payload)) {
            offenders.push(`${path} writes ${field} to an account`);
          }
        }
      }
    }
    // settings.tsx and goals.tsx write these through `useGoal().update` — the
    // goal row, not the accounts table — so nothing should appear here at all.
    expect([...new Set(offenders)]).toEqual([]);
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
