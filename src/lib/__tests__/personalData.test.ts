// Reintroduction guard for the 2026-09-05 P0 remediation.
//
// Removing personal data once is not a control; the control is a test that
// fails when it comes back. This is the same shape as the margin-rate guard in
// marginCost.test.ts, which is the one thing that actually kept 11.825 out of
// the source after it was removed.
//
// Scope: EVERY file under src/ and supabase/, whatever the extension, comments
// included — a real balance in a comment is still a real balance in a public
// repository, and a needle does not care whether it sits in .tsx, .sql, .css,
// .toml or .md. The scan filters nothing, and a coverage test below pins that
// rather than leaving the claim to a comment (Copilot, #136).
//
// KNOWN GAPS, deliberately not asserted here because the data is still present
// and removing it is not a cosmetic change (reported with this PR):
//   - Three children's first names are load-bearing in application logic
//     (KID_NAMES / KID_ORDER, route matchers, kids prompt templates).
//   - src/lib/data/familyPolicy.ts carries three minors' birth dates.
//   - src/lib/data/kidsSeed.ts carries account-number-shaped strings.
// Adding those needles here before that data is removed would land a failing
// test in CI, so they are listed in the PR instead and belong in the follow-up.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// This file is excluded rather than allowlisted. A guard that scans itself
// always needs a total exemption — it necessarily spells out everything it
// forbids — and a total exemption is exactly the shape this allowlist is
// designed to prevent. Excluding it keeps the allowlist meaning one thing.
const SELF = "src/lib/__tests__/personalData.test.ts";
const scanned = [...walk("src"), ...walk("supabase")].filter((f) => f !== SELF);

/** Needles that must not reappear, with what each one is. */
const FORBIDDEN: { label: string; re: RegExp }[] = [
  { label: "the owner's first name", re: /\bamir\b/i },
  { label: "real total account value", re: /53[,_]?938\.35/ },
  { label: "real net debit", re: /6[,_]?664\.33/ },
  { label: "real margin market value", re: /60[,_]?602\.(30?|68)/ },
  { label: "real day change", re: /1[,_]?196\.68/ },
  { label: "real margin buying power", re: /82[,_]?191\.43/ },
  { label: "real non-margin buying power", re: /24[,_]?657\.43/ },
  { label: "real committed-to-open-orders", re: /18[,_]?209\.97/ },
  { label: "real net house surplus", re: /30[,_]?803\.11/ },
  { label: "real accrued margin interest", re: /(?<![\d.])91\.22(?![\d])/ },
  { label: "the owner's real margin rate", re: /(?<![\d.])(11\.325|0\.11325)(?![\d])/ },
];

// Exemptions are per FILE AND PER NEEDLE, not per file.
//
// The first version of this allowlist exempted whole files. That is too coarse
// and it hid real data: marginCost.test.ts was exempted so its absence-guard
// could spell out the rates it forbids, and that exemption silently covered an
// unrelated real accrued-interest figure sitting in the same file as an
// ordinary fixture (Copilot, #136). An exemption now covers exactly the needle
// it was argued for; every other needle in that file still fails.
const ALLOWED: Record<string, { why: string; needles: string[] }> = {
  "src/lib/__tests__/marginCost.test.ts": {
    why: "absence guard: asserts the rates never appear in production source",
    needles: ["the owner's real margin rate"],
  },
  "src/lib/__tests__/promptMandate.test.ts": {
    why: "absence guard: asserts the mandate carries no account literal",
    needles: ["the owner's first name"],
  },
  "src/lib/__tests__/nav.test.ts": {
    why: "absence guard: asserts no nav label is the owner's name",
    needles: ["the owner's first name"],
  },
  // UNRESOLVED: an already-applied migration whose comment still names the
  // owner. Editing an applied migration in place risks a checksum mismatch on
  // the next `supabase db push`, so it is the owner's call, not a silent fix.
  "supabase/migrations/20260903020000_ips_lite_margin_rate.sql": {
    why: "applied migration; comment edit deferred to the owner (see PR)",
    needles: ["the owner's first name"],
  },
  // PENDING TIER 2 — the new-user trigger and column defaults still seed one
  // person's account name, target and date. Removing them needs a forward
  // migration, which is the next PR. These entries come out with it.
  "supabase/migrations/20260723211412_0ebbafa7-74cc-4c83-aa77-8201625a9dfb.sql": {
    why: "pending Tier 2: personal defaults in the new-user trigger",
    needles: ["the owner's first name"],
  },
  "supabase/migrations/20260725025027_portfolio_snapshots.sql": {
    why: "pending Tier 2: personal default on portfolio_snapshots.scope",
    needles: ["the owner's first name"],
  },
  // PENDING TIER 3 — the committee templates embed the office identity. They
  // are governance artifacts supplied verbatim, so the identity gets
  // parameterised rather than reworded, which is money-adjacent.
  "src/lib/prompts.ts": {
    why: "pending Tier 3: office identity to be parameterised",
    needles: ["the owner's first name"],
  },
};

describe("personal data does not reappear in src/ or supabase/", () => {
  test("no file carries a real name or a real balance figure", () => {
    const offenders: string[] = [];
    for (const file of scanned) {
      const exempt = ALLOWED[file]?.needles ?? [];
      const text = readFileSync(file, "utf8");
      for (const { label, re } of FORBIDDEN) {
        if (exempt.includes(label)) continue;
        if (re.test(text)) offenders.push(`${file}: ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the scan actually reaches the files it claims to", () => {
    // A guard that walks an empty tree passes forever, and a guard that
    // silently filters by extension protects less than its comment claims.
    expect(scanned.length).toBeGreaterThan(80);
    expect(scanned).toContain("src/components/app/BalanceImport.tsx");
    expect(scanned).toContain("src/lib/accountTotals.ts");
    expect(scanned).not.toContain(SELF);
    expect(scanned.some((f) => f.startsWith("supabase/migrations/"))).toBe(true);

    const exts = new Set(scanned.map((f) => f.slice(f.lastIndexOf(".") + 1)));
    for (const ext of ["tsx", "ts", "sql", "css", "toml", "md"]) {
      expect([...exts]).toContain(ext);
    }
  });

  test("every allowlisted needle still exists, and names a real needle", () => {
    // Stale exemptions are how a hole outlives its reason.
    const stale: string[] = [];
    for (const [file, { why, needles }] of Object.entries(ALLOWED)) {
      if (!scanned.includes(file)) {
        stale.push(`${file} is allowlisted (${why}) but is no longer scanned`);
        continue;
      }
      const text = readFileSync(file, "utf8");
      for (const label of needles) {
        const rule = FORBIDDEN.find((f) => f.label === label);
        if (!rule) stale.push(`${file} exempts "${label}", which is not a needle`);
        else if (!rule.re.test(text)) {
          stale.push(`${file} exempts "${label}" (${why}) but no longer contains it — drop it`);
        }
      }
    }
    expect(stale).toEqual([]);
  });
});
