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
  DEFAULT_OFFICE_NAME,
  type PromptContext,
} from "../prompts";
import type { Objective } from "../objective";

/** A complete objective, as `objectiveOf()` would return one. */
function setObjective(
  overrides: Partial<Extract<Objective, { kind: "set" }>> = {},
): Objective {
  return {
    kind: "set",
    startingValue: 60_000,
    targetValue: 250_000,
    targetDate: "2030-06-30",
    monthlyContribution: 0,
    ...overrides,
  };
}

function ctx(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    accountName: "Growth Brokerage",
    portfolioValue: 72_500,
    cash: 2_500,
    marginUsed: 0,
    buyingPower: 5_000,
    todaysPL: 0,
    todaysPLPct: 0,
    // Required as of Phase 4: the caps used to be optional with `?? 30` and
    // `?? 25` fallbacks at the template, so a caller that forgot them still
    // produced a prompt asserting a 30% cap as HARD GOVERNANCE.
    ipsPositionCapPct: 30,
    ipsPositionCapHard: false,
    ipsMarginCapPct: 25,
    ipsCapsSource: "user_set",
    objective: setObjective(),
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
    expect(mandateOf(ctx({ objective: setObjective({ targetDate: "2027-03-31" }) })).date).toBe("March 31, 2027");
  });

  test("falls back to neutral wording rather than a name when unset", () => {
    expect(mandateOf(ctx({ accountName: "   " })).account).toBe("this portfolio");
  });

  test("says an unusable date is unset rather than rendering Invalid Date", () => {
    // This used to pass "—" through untouched, which was better than "Invalid
    // Date" and still wrong: a dash in "by —" reads as a formatting glitch in
    // an otherwise complete mandate, not as "nobody set a horizon".
    // Constructed by hand: `objectiveOf()` would never return this. The point
    // is that the mandate degrades WHOLE rather than rendering a real target
    // beside a dash, which reads as a formatting glitch, not a missing horizon.
    for (const bad of ["—", "2027-02-31", ""]) {
      const m = mandateOf(ctx({ objective: setObjective({ targetDate: bad }) }));
      expect(m.date).toBe("an UNSET date");
      expect(m.target).toBe("an UNSET target");
      expect(m.objective).toContain("NOT BEEN SET");
    }
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

    test(`${name}: no prompt names the owner`, () => {
      // Rule 23. True of every builder, whether or not it carries the office
      // identity — the name must not reach the model by any route.
      expect(build(ctx())).not.toMatch(/\bamir\b/i);
      expect(build(ctx({ officeName: "Northwind Family Office" }))).not.toMatch(/\bamir\b/i);
    });

    test(`${name}: a changed goal changes the prompt`, () => {
      const before = build(ctx());
      const after = build(ctx({ objective: setObjective({ targetValue: 999_000, targetDate: "2031-01-15" }) }));
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

describe("the objective has exactly one home per scope", () => {
  // CHANGED IN PHASE 4, deliberately, and this note is the record of why.
  //
  // The P0 remediation forbade writing ANY objective field to `accounts`: the
  // Settings form wrote `target_value` / `target_date` / `starting_value` onto
  // the account, nothing read them, and the dashboard, the goal screen and the
  // committee prompt all read the `goals` row. So the editor looked like
  // setting a target and set nothing.
  //
  // Rule 20 associates a goal with "user / household / ACCOUNT / portfolio",
  // and `/kids` now reads each account's own target and horizon — the figures
  // that used to be `FAMILY_POLICY.targetPerChild` and `.targetDate` for every
  // account of every user. So an account-level objective is real, and the two
  // are different scopes rather than two copies of one thing: `goals` is the
  // user's primary objective, `accounts.target_value` is that account's own.
  //
  // What has NOT changed: `starting_value` is still never written to an
  // account, because nothing measures an account's progress from it — /kids
  // measures from what the account is worth now.
  const NEVER_ON_AN_ACCOUNT = ["starting_value"];
  const ACCOUNT_SCOPED = ["target_value", "target_date"];
  const OBJECTIVE_FIELDS = [...NEVER_ON_AN_ACCOUNT, ...ACCOUNT_SCOPED];

  // Per file AND per field, never per file — the lesson from #136. The account
  // editor may write an account's own target; it may not write a starting
  // value, and no other file may write either.
  const ACCOUNT_WRITERS: Record<string, string[]> = {
    "src/routes/_authenticated/settings.tsx": ACCOUNT_SCOPED,
  };

  // Files that only DECLARE the row shape. `kidAccounts.ts` joined them in
  // Phase 4: it names `target_value` and `target_date` in `KidAccountRow` so
  // the reader knows what it may read, and the payload scanner sweeps them in
  // because `account_type` sits three lines above. It writes nothing.
  const SHAPE_ONLY = [
    "src/integrations/supabase/types.ts",
    "src/hooks/useAppData.ts",
    "src/lib/kidAccounts.ts",
  ];

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
  const ACCOUNTS_TABLE_WRITE =
    /\.from\(\s*["']accounts["']\s*\)[\s\S]{0,80}?\.(update|insert|upsert)\(/g;
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
      // Files that DECLARE the row shape must describe these columns — the
      // data is there, and a type that denied it would be lying about the
      // database. None of them constructs a payload: `useAccounts().update`
      // takes a `Partial<Account>` and passes it through, so every payload is
      // built at a call site, which is what this scan covers. The test below
      // pins that these files contain no write at all, so the exemption cannot
      // quietly start covering one.
      if (SHAPE_ONLY.includes(path)) continue;
      const code = stripComments(readFileSync(file, "utf8"));
      const allowed = ACCOUNT_WRITERS[path] ?? [];
      for (const payload of accountPayloads(code)) {
        for (const field of OBJECTIVE_FIELDS) {
          if (allowed.includes(field)) continue;
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

  test("in the shape-only exemptions, every objective field is a TYPE", () => {
    // The exemption is argued as "these files declare the row shape, they do
    // not build payloads". `useAppData.ts` plainly contains writes — it is the
    // hooks module — so "contains no mutation" would be the wrong control and
    // was: it failed on the first run. The claim that actually needs holding is
    // narrower: in these files, an objective field only ever appears as a type
    // declaration, never as a key assigned a value.
    //
    // `target_value: number | null;`             — a declaration, fine.
    // `target_value: numberOrUnknown(form.x),`   — a payload, not fine.
    const DECLARATION = /^\s*(string|number|boolean|Date)?(\s*\|\s*null)?\s*;?\s*$/;
    const offenders: string[] = [];
    for (const path of SHAPE_ONLY) {
      const code = stripComments(readFileSync(path, "utf8"));
      for (const field of OBJECTIVE_FIELDS) {
        const re = new RegExp(`(^|[^.\\w])${field}\\??\\s*:([^;\n]*)`, "gm");
        for (const m of code.matchAll(re)) {
          if (!DECLARATION.test(m[2]!)) offenders.push(`${path}: ${field}:${m[2]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("NEGATIVE CONTROL: that check tells a declaration from a payload", () => {
    // Without this it would pass on a regex that matches everything.
    const DECLARATION = /^\s*(string|number|boolean|Date)?(\s*\|\s*null)?\s*;?\s*$/;
    expect(DECLARATION.test(" number | null;")).toBe(true);
    expect(DECLARATION.test(" string | null;")).toBe(true);
    expect(DECLARATION.test(" numberOrUnknown(form.target_value),")).toBe(false);
    expect(DECLARATION.test(" 200_000,")).toBe(false);
    expect(DECLARATION.test(' account.target_value ?? "",')).toBe(false);
  });

  test("NEGATIVE CONTROL: the writer allowlist is per field, not per file", () => {
    // settings.tsx is allowed `target_value` and `target_date`. It must NOT be
    // allowed `starting_value` — a per-file exemption would have granted it.
    expect(ACCOUNT_WRITERS["src/routes/_authenticated/settings.tsx"]).not.toContain(
      "starting_value",
    );
    for (const [, allowed] of Object.entries(ACCOUNT_WRITERS)) {
      for (const field of allowed) expect(OBJECTIVE_FIELDS).toContain(field);
    }
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

  // The union makes the ACCIDENTAL fabrication unrepresentable: there is no
  // longer a loose `goalTarget` for `?? 0` to attach to. It cannot stop a
  // deliberate one — writing `{ kind: "set", targetValue: 0 }` by hand
  // typechecks — so the one remaining rule is stated as a rule: `objectiveOf`
  // is the only producer, and no screen builds an objective of its own.
  test("no screen constructs an objective; they all come from objectiveOf", () => {
    const offenders: string[] = [];
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((e) => {
        const full = join(dir, e);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    for (const file of walk("src/routes")) {
      const code = stripComments(readFileSync(file, "utf8"));
      if (/kind:\s*["']set["']/.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test("the mandate the committee reads comes from the goal, not an account", () => {
    // Restated as behaviour rather than as source-shape: change the objective
    // and the prompt changes with it.
    const before = mandateOf(ctx());
    const after = mandateOf(ctx({ objective: setObjective({ targetValue: 400_000, targetDate: "2032-01-31" }) }));
    expect(before.target).not.toBe(after.target);
    expect(after.target).toBe("$400,000");
    expect(after.date).toBe("January 31, 2032");
  });
});

// What the committee is told when there is no objective. This is the
// money-adjacent half of Tier 2: an unset objective used to reach the model as
// "Goal: $0.00 by  | Required CAGR: 0.0% | Model probability: 0.0%" — four
// fabricated facts in one line, each of which reads as a real finding.
describe("an unset objective reaches the model as unset, not as zero", () => {
  // NULL throughout, which is what the goals row now actually holds. The
  // `kind: "unset"`, which is now the only way to say it: the three loose
  // fields this replaced could each be given a plausible-looking default, and
  // the earlier version of this helper duly passed `goalTarget: 0` and
  // `goalDate: ""` — testing the fabrication rather than its absence.
  const unset = () =>
    ctx({ requiredCagr: null, probability: null, objective: { kind: "unset", missing: [] } });
  const all: Array<[string, (c: PromptContext) => string]> = [
    ["v6", (c) => buildV6Prompt({ ...c, meeting: "Morning" })],
    ["v5", (c) => buildV5Prompt({ ...c, meeting: "Morning" })],
    ["universal", (c) => buildUniversalPrompt({ ...c, meeting: "Morning" })],
    ["morning", buildMorningPrompt],
    ["eod", (c) => buildEODPrompt({ ...c, tradesToday: "(none)" })],
    ["weekly", buildWeeklyPrompt],
    ["midday", buildMiddayPrompt],
  ];

  for (const [name, build] of all) {
    test(`${name}: says the objective is not set`, () => {
      const out = build(unset());
      // Anchored to "Goal:" on purpose. A bare "NOT SET" is already in every
      // prompt via the margin-rate line, so asserting that alone passes
      // whether or not the objective line was fixed — my first version of this
      // test did exactly that and a negative control caught it.
      expect(out).toContain("Goal: NOT SET. No target, date or probability is available");
      expect(out).not.toContain("Required CAGR: 0.0%");
      expect(out).not.toContain("Model probability: 0.0%");
    });

    test(`${name}: emits no required pace it cannot compute`, () => {
      const out = build(unset());
      expect(out).toContain("not available while the objective is unset");
      expect(out).not.toMatch(/Required pace: 0\.0%\/week/);
    });

    test(`${name}: a set objective still reports its figures`, () => {
      // The unset path must not swallow the normal one.
      const out = build(ctx());
      expect(out).toContain("Required CAGR:");
      expect(out).not.toContain("NOT SET. No target");
    });

    // The data block was only half of it. The MANDATE names the objective too,
    // at seventeen sites across the constitutions, and it read
    // "growing the X portfolio from approximately $0 to $0 by —" — a target of
    // zero dollars given to the committee as its instruction, which is a
    // stronger claim than anything in the data block (Copilot, #138).
    test(`${name}: the mandate names no target it does not have`, () => {
      const out = build(unset());
      expect(out).toContain("an UNSET target");
      expect(out).not.toMatch(/from approximately \$0 to \$0/);
      expect(out).not.toMatch(/to \$0 by/);
      expect(out).not.toMatch(/reaching \$0/);
      expect(out).not.toMatch(/ by —/);
    });

    test(`${name}: a set objective still states the mandate in full`, () => {
      const out = build(ctx());
      expect(out).toContain("$250,000");
      expect(out).not.toContain("UNSET target");
      expect(out).not.toContain("UNSET date");
      expect(out).not.toContain("NOT BEEN SET");
    });
  }
});

// Only the v5 and v6 constitutions carry an office identity; the other builders
// have their own wording and name no office at all. Asserting the identity is
// data-driven therefore belongs here, not in the loop over every builder.
//
// The slots are asserted individually rather than by "the default no longer
// appears": the constitutions contain the phrase "institutional investment
// office" as ordinary prose, so a substring check on the default label can
// never pass. Naming each slot also proves every occurrence was reached, which
// the substring check would not.
describe("the office identity in the constitutions is configuration, not a person", () => {
  const slots = {
    v5: (o: string) => [`${o.toUpperCase()} OS v5.0`, `investment office for the ${o}.`],
    v6: (o: string) => [
      `${o.toUpperCase()} OS v6.0`,
      `You are ${o} OS v6.0.`,
      `investment office for the ${o}.`,
    ],
  };

  const builders = [
    ["v5", (c: PromptContext) => buildV5Prompt({ ...c, meeting: "Morning" })],
    ["v6", (c: PromptContext) => buildV6Prompt({ ...c, meeting: "Morning" })],
  ] as const;

  for (const [name, build] of builders) {
    test(`${name}: falls back to a generic office, never to a person`, () => {
      const out = build(ctx());
      for (const slot of slots[name](DEFAULT_OFFICE_NAME)) expect(out).toContain(slot);
      expect(out).not.toMatch(/\bamir\b/i);
    });

    test(`${name}: the original artifact is reproducible from configuration`, () => {
      // The identity token is the whole phrase, so a deployment can reproduce
      // the constitution's original title verbatim — the word INVESTMENT was
      // part of the name, not fixed text (Copilot, #137).
      const out = build(ctx({ officeName: "Northwind Investment" }));
      expect(out).toContain(`NORTHWIND INVESTMENT OS ${name === "v5" ? "v5.0" : "v6.0"}`);
    });

    test(`${name}: a configured office name fills every slot`, () => {
      const office = "Northwind Family Office";
      const out = build(ctx({ officeName: office }));
      for (const slot of slots[name](office)) expect(out).toContain(slot);
      // No slot may still be carrying the fallback.
      for (const slot of slots[name](DEFAULT_OFFICE_NAME)) expect(out).not.toContain(slot);
    });
  }
});
