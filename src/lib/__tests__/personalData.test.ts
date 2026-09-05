// Reintroduction guard for the 2026-09-05 P0 remediation.
//
// Removing personal data once is not a control; the control is a test that
// fails when it comes back. This is the same shape as the margin-rate guard in
// marginCost.test.ts, which is the one thing that actually kept 11.825 out of
// the source after it was removed.
//
// Scope: every file under src/ and supabase/, comments included — a real
// balance in a comment is still a real balance in a public repository.
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

function walk(dir: string, exts: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.test(entry)) out.push(full);
  }
  return out;
}

const scanned = [...walk("src", /\.(tsx?|css)$/), ...walk("supabase", /\.sql$/)];

// Files allowed to contain a needle, each for a stated reason. An allowlist
// entry is a claim that has to be defensible, not a way to silence the test.
const ALLOWED: Record<string, string> = {
  // This file names what it forbids.
  "src/lib/__tests__/personalData.test.ts": "the guard itself",
  // Absence guards: they assert the value does NOT appear elsewhere, which
  // requires spelling it out. Removing them would remove the protection.
  "src/lib/__tests__/marginCost.test.ts": "asserts the rates never appear in source",
  "src/lib/__tests__/promptMandate.test.ts": "asserts the mandate carries no account literal",
  "src/lib/__tests__/nav.test.ts": "asserts no nav label is the owner's name",
  // UNRESOLVED: an already-applied migration whose comment still names the
  // owner. Editing an applied migration in place risks a checksum mismatch on
  // the next `supabase db push`, so it is Amir's call, not a silent fix.
  "supabase/migrations/20260903020000_ips_lite_margin_rate.sql":
    "applied migration; comment edit deferred to the owner (see PR)",
  // PENDING TIER 2 — the new-user trigger and column defaults still seed one
  // person's account name, target and date. Removing them needs a forward
  // migration, which is the next PR. These entries come out with it.
  "supabase/migrations/20260723211412_0ebbafa7-74cc-4c83-aa77-8201625a9dfb.sql":
    "pending Tier 2: personal defaults in the new-user trigger",
  "supabase/migrations/20260725025027_portfolio_snapshots.sql":
    "pending Tier 2: personal default on portfolio_snapshots.scope",
  // PENDING TIER 3 — the committee templates embed the office identity. They
  // are governance artifacts supplied verbatim, so the identity gets
  // parameterised rather than reworded, which is money-adjacent and needs
  // line-item sign-off.
  "src/lib/prompts.ts": "pending Tier 3: office identity to be parameterised",
};

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

describe("personal data does not reappear in src/ or supabase/", () => {
  test("no file carries a real name or a real balance figure", () => {
    const offenders: string[] = [];
    for (const file of scanned) {
      if (ALLOWED[file]) continue;
      const text = readFileSync(file, "utf8");
      for (const { label, re } of FORBIDDEN) {
        if (re.test(text)) offenders.push(`${file}: ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the scan actually reaches the files it claims to", () => {
    // A guard that walks an empty tree passes forever. Pin the shape of the
    // sweep, not just its verdict.
    expect(scanned.length).toBeGreaterThan(80);
    expect(scanned).toContain("src/components/app/BalanceImport.tsx");
    expect(scanned).toContain("src/lib/accountTotals.ts");
    expect(scanned.some((f) => f.startsWith("supabase/migrations/"))).toBe(true);
  });

  test("every allowlist entry names a file that exists and carries a needle", () => {
    // Stale allowlist entries are how an exemption outlives its reason.
    const stale: string[] = [];
    for (const [file, why] of Object.entries(ALLOWED)) {
      if (!scanned.includes(file)) {
        stale.push(`${file} is allowlisted (${why}) but no longer scanned`);
        continue;
      }
      const text = readFileSync(file, "utf8");
      if (!FORBIDDEN.some(({ re }) => re.test(text))) {
        stale.push(`${file} is allowlisted (${why}) but contains no needle — drop the entry`);
      }
    }
    expect(stale).toEqual([]);
  });
});
