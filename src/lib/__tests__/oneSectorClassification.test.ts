// UNIV-001 has two halves that only a source scan can hold.
//
// A unit test proves `canonicalSector` resolves correctly. It cannot prove that
// nothing ELSE resolves a sector, or that the price screen has not quietly
// grown a conviction ranking — and both are the actual requirement.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function sourceFiles(dir = "src"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "__tests__") continue;
      out.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

/** Comments describe the rule; only code can break it. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("one canonical sector classification (UNIV-001)", () => {
  test("SECTOR_MAP is read by exactly one module", () => {
    // The map is the last-resort source. A second reader is a second
    // precedence order, which is the defect the requirement names.
    const readers = sourceFiles()
      .filter((f) => !f.endsWith("src/lib/data/sectors.ts"))
      .filter((f) => /\bSECTOR_MAP\b/.test(stripComments(readFileSync(f, "utf8"))));
    expect(readers).toEqual(["src/lib/securityMaster.ts"]);
  });

  test("the deleted resolver has not come back", () => {
    // `sectorFor` returned a bare string, so a caller could not tell whether a
    // classification came from a human or from the map. A function with no
    // callers that still answers the same question is how the second
    // classification returns.
    const offenders = sourceFiles().filter((f) =>
      /\bsectorFor\s*[(=]/.test(stripComments(readFileSync(f, "utf8"))),
    );
    expect(offenders).toEqual([]);
  });

  test("NEGATIVE CONTROL: the scan can see a reader when there is one", () => {
    expect(/\bSECTOR_MAP\b/.test(stripComments('import { SECTOR_MAP } from "x";'))).toBe(true);
    expect(/\bsectorFor\s*[(=]/.test(stripComments("const k = sectorFor(a, b);"))).toBe(true);
    // And is not fooled by the prose above, which names both.
    expect(/\bsectorFor\s*[(=]/.test(stripComments("// sectorFor(a, b) used to live here"))).toBe(
      false,
    );
  });
});

describe("the price screen is not a conviction ranking (UNIV-001)", () => {
  // `main` already separates these, and says so in the copy. This pins it:
  // the requirement is easy to satisfy today and easy to lose the next time
  // somebody has universe scores in hand and an empty column to fill.
  const opportunities = readFileSync("src/routes/_authenticated/opportunities.tsx", "utf8");

  test("it ranks by price change and by nothing else", () => {
    const code = stripComments(opportunities);
    expect(code).toContain("b.changePct - a.changePct");
    // The universe's scores are the conviction ranking. None of them belongs
    // on a screen whose ordering is today's percentage move.
    for (const score of [
      "overall_conviction",
      "business_quality",
      "technical_strength",
      "relative_strength",
    ]) {
      expect(code).not.toContain(score);
    }
  });

  test("it says in the copy that it is a screen, not a thesis", () => {
    // Copy, not code — so this reads the file whole, comments included.
    expect(opportunities).toContain("not ranked by conviction");
    expect(opportunities).toContain("a screen, not a thesis");
  });
});
