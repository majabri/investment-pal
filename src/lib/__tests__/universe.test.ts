// Stage 2: earnings.tsx and opportunities.tsx each hardcoded the same 24
// symbols while `investment_universe` was queried by nothing. These tests pin
// the union rules and, most importantly, that no ticker list survives in source.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { resolveUniverse, universeEmptyReason, heldSymbolSet, normaliseSymbol } from "../universe";

describe("resolveUniverse", () => {
  test("unions the stored universe with current holdings", () => {
    expect(resolveUniverse(["MSFT", "NVDA"], ["AAPL"])).toEqual(["AAPL", "MSFT", "NVDA"]);
  });

  test("holdings come first — a position owned is not merely a candidate", () => {
    expect(resolveUniverse(["MSFT"], ["AAPL", "TSLA"])[0]).toBe("AAPL");
  });

  test("de-duplicates across the two sources", () => {
    expect(resolveUniverse(["AAPL", "MSFT"], ["AAPL"])).toEqual(["AAPL", "MSFT"]);
  });

  test("normalises case and whitespace so casing cannot duplicate a symbol", () => {
    expect(resolveUniverse([" msft ", "MSFT"], ["aapl"])).toEqual(["AAPL", "MSFT"]);
  });

  test("drops blanks rather than scanning an empty ticker", () => {
    expect(resolveUniverse(["", "   "], [])).toEqual([]);
  });

  test("an empty universe yields exactly the holdings — never a fallback list", () => {
    // The whole defect: falling back to a baked-in set of names.
    expect(resolveUniverse([], ["AAPL"])).toEqual(["AAPL"]);
  });
});

describe("held lookup uses the same form as the scan list", () => {
  // Post-merge Copilot finding, reproduced before fixing: the scan list is
  // normalised to uppercase but `held` was built from raw holdings symbols, so
  // a position stored as "msft" stopped showing its Held badge. The position
  // was still owned — the screen just quietly stopped saying so.
  test("a lowercase holding still matches the normalised scan symbol", () => {
    const symbols = resolveUniverse([], ["msft"]);
    const held = heldSymbolSet(["msft"]);
    expect(symbols).toEqual(["MSFT"]);
    expect(held.has(symbols[0])).toBe(true);
  });

  test("whitespace does not break the match either", () => {
    expect(heldSymbolSet([" aapl "]).has(normaliseSymbol("AAPL"))).toBe(true);
  });

  test("blank holdings do not enter the set", () => {
    expect(heldSymbolSet(["", "  "]).size).toBe(0);
  });
});

describe("universeEmptyReason", () => {
  test("nothing anywhere is a setup task", () => {
    expect(universeEmptyReason([], [])).toBe("none-configured");
  });

  test("holdings but no universe is a narrower scan, not an empty one", () => {
    expect(universeEmptyReason([], ["AAPL"])).toBe("holdings-only");
  });

  test("a configured universe is not empty", () => {
    expect(universeEmptyReason(["MSFT"], [])).toBeNull();
  });
});

/**
 * The two pages this stage fixed.
 *
 * Deliberately not all of `src/`. Four other files hold ticker lists —
 * `familyPolicy.ts`, `watchlist.tsx`, `prompt-center.tsx` and (a false positive
 * on action words) `committeeScorecard.ts`. They are real, they are recorded in
 * the session log, and they are a different concern: family policy and themed
 * watchlists are not the scanned investment universe. Asserting over all of
 * `src/` would have made this test a scope-creep engine that fails until
 * unrelated decisions get made.
 */
const STAGE_2_PAGES = [
  "src/routes/_authenticated/earnings.tsx",
  "src/routes/_authenticated/opportunities.tsx",
];

describe("no hardcoded ticker universe survives on the scanning pages", () => {
  test("neither page contains an inline ticker array", () => {
    // Both held the same 24 symbols verbatim. The signature of that defect is a
    // long array literal of short quoted uppercase strings.
    const pattern = /\[\s*(?:"[A-Z][A-Z.]{0,5}"\s*,\s*){5,}/;
    const offenders = STAGE_2_PAGES.filter((f) => pattern.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  test("neither page mentions the old constants", () => {
    for (const f of STAGE_2_PAGES) {
      const src = readFileSync(f, "utf8");
      expect(src).toContain("resolveUniverse");
      expect(src).not.toMatch(/const (WATCH|UNIVERSE)\s*=/);
    }
  });

  test("the Earnings page no longer claims to scan a watchlist", () => {
    // It reads holdings + investment_universe now. Copy that names a source the
    // page does not use is misleading on a screen about real money.
    const src = readFileSync("src/routes/_authenticated/earnings.tsx", "utf8");
    const subtitle = src.match(/subtitle="([^"]*)"/)?.[1] ?? "";
    expect(subtitle.toLowerCase()).not.toContain("watchlist");
    expect(subtitle.toLowerCase()).toContain("investment universe");
    // The per-row badge said "Watchlist" for universe-only names too.
    expect(src).not.toContain(">Watchlist<");
  });

  test("the Opportunities subtitle does not claim committee involvement", () => {
    // The page sorts daily percentage movers. Copy that overstates the analysis
    // behind it is worse than plain copy on a screen used for real money.
    const src = readFileSync("src/routes/_authenticated/opportunities.tsx", "utf8");
    const subtitle = src.match(/subtitle="([^"]*)"/)?.[1] ?? "";
    expect(subtitle).not.toMatch(/conviction ranking comes from/i);
    expect(subtitle.toLowerCase()).toContain("price screen");
  });
});
