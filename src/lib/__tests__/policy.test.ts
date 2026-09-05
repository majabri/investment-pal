// Phase 4, rules 15 and 21.
//
// Rule 15: a default must be labelled a default and must never masquerade as a
// user preference. Rule 21: system safety rules, broker/regulatory
// constraints, user risk policy, strategy rules and AI recommendations are not
// interchangeable, and the UI must show which is which.
//
// The defect both rules describe was one thing in `ips_lite`: a 30% position
// cap and a 25% margin cap that nothing downstream could tell from a choice.
// The Settings form pre-filled them, the dashboard flagged breaches of them as
// "⚠ NVDA 34.2% > 30% cap", and the committee prompt stated them under
// "INVESTMENT POLICY (IPS-lite) — HARD GOVERNANCE" — all of it whether or not
// a person had ever opened the form.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  POLICY_CLASSES,
  POLICY_CLASS_LABEL,
  POLICY_CLASS_MEANING,
  POLICY_SOURCES,
  POLICY_SOURCE_LABEL,
  describePolicyForPrompt,
  policyIsConfirmed,
  policySourceOf,
  type PolicyClass,
} from "../policy";

describe("policySourceOf", () => {
  test("only the literal 'user_set' is a confirmation", () => {
    expect(policySourceOf("user_set")).toBe("user_set");
  });

  test("null, empty and unrecognised are legacy_unknown, never user_set", () => {
    // An unreadable provenance must not promote itself into a confirmation —
    // the same call `accountTypeIsConfirmed` makes for `account_type_source`.
    for (const v of [null, undefined, "", "USER_SET", "chosen", "legacy_unknown", "default"]) {
      expect(policySourceOf(v)).toBe("legacy_unknown");
    }
  });
});

describe("policyIsConfirmed", () => {
  test("user_set is confirmed", () => {
    expect(policyIsConfirmed("user_set")).toBe(true);
  });

  test("everything else is not", () => {
    // `default` is not a preference. `legacy_unknown` is a row that may hold a
    // choice or may hold the schema default, and the app cannot tell.
    for (const v of ["default", "legacy_unknown", "not_set", null, undefined] as const) {
      expect(policyIsConfirmed(v)).toBe(false);
    }
  });
});

describe("describePolicyForPrompt", () => {
  test("a user-set limit is attributed to the user", () => {
    const line = describePolicyForPrompt("Max single position", "30% of gross", {
      policyClass: "user_policy",
      source: "user_set",
    });
    expect(line).toContain("set by the user");
  });

  test("a default says so, in words a model cannot read past", () => {
    const line = describePolicyForPrompt("Max single position", "30% of gross", {
      policyClass: "user_policy",
      source: "default",
    });
    expect(line).toContain("NOT set by the user");
    expect(line).not.toContain("set by the user (");
  });

  test("an unconfirmed limit is not attributed to anyone", () => {
    const line = describePolicyForPrompt("Max margin utilisation", "25%", {
      policyClass: "user_policy",
      source: "legacy_unknown",
    });
    expect(line).toContain("unconfirmed");
  });

  test("the class travels with the value", () => {
    // Rule 21: a regulatory constraint stated in the same words as a
    // preference invites someone to relax the one they cannot relax.
    const line = describePolicyForPrompt("Maintenance equity", "50%", {
      policyClass: "regulatory",
      source: "user_set",
    });
    expect(line).toContain("broker / regulatory");
  });

  test("NEGATIVE CONTROL: the four sources produce four different sentences", () => {
    const lines = POLICY_SOURCES.map((source) =>
      describePolicyForPrompt("Cap", "30%", { policyClass: "user_policy", source }),
    );
    expect(new Set(lines).size).toBe(POLICY_SOURCES.length);
  });
});

describe("the vocabularies are complete", () => {
  test("every class has a label and a meaning", () => {
    // A missing entry would render `undefined` in a badge, which reads as a
    // rendering bug rather than as the missing distinction it would be.
    for (const c of POLICY_CLASSES) {
      expect(POLICY_CLASS_LABEL[c]).toBeTruthy();
      expect(POLICY_CLASS_MEANING[c]).toBeTruthy();
    }
    for (const s of POLICY_SOURCES) expect(POLICY_SOURCE_LABEL[s]).toBeTruthy();
  });

  test("rule 21's five classes are all present", () => {
    // Listed literally so adding a sixth class, or quietly dropping one, has
    // to be a deliberate edit here as well as in the module.
    const expected = [
      "ai_recommendation",
      "regulatory",
      "strategy",
      "system_safety",
      "user_policy",
    ] as PolicyClass[];
    expect([...POLICY_CLASSES].sort()).toEqual(expected.sort());
  });

  test("the class labels are distinct", () => {
    // Two classes sharing a label would defeat the whole point: the UI would
    // show which is which and they would be the same which.
    expect(new Set(Object.values(POLICY_CLASS_LABEL)).size).toBe(POLICY_CLASSES.length);
  });
});

describe("the prompt template states the caps without a fallback", () => {
  const strip = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const prompts = strip(readFileSync("src/lib/prompts.ts", "utf8"));

  test("no `?? 30` or `?? 25` behind the IPS caps", () => {
    // The template read `${ctx.ipsPositionCapPct ?? 30}% of gross` under a
    // heading that says HARD GOVERNANCE, so a caller that simply forgot to
    // pass the caps still produced a prompt asserting a 30% limit as the
    // user's own. The fields are required now; this is the check that the
    // fallback did not survive the type change.
    expect(prompts).not.toMatch(/ipsPositionCapPct\s*\?\?/);
    expect(prompts).not.toMatch(/ipsMarginCapPct\s*\?\?/);
  });

  test("the provenance line is emitted, not just defined", () => {
    expect(prompts).toMatch(/capsProvenanceLine\(ctx\.ipsCapsSource\)/);
  });

  test("NEGATIVE CONTROL: those patterns match the code that was removed", () => {
    const removed = "Max single position: ${ctx.ipsPositionCapPct ?? 30}% of gross";
    expect(removed).toMatch(/ipsPositionCapPct\s*\?\?/);
  });

  test("NEGATIVE CONTROL: stripping comments does not blank the file", () => {
    expect(prompts).toContain("PromptContext");
    expect(prompts).toContain("HARD GOVERNANCE");
  });
});
