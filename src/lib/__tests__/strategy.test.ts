// Phase 4, rules 16 and 21.
//
// Rule 16: "the accounting layer supports long-term, swing, income, ETF,
// retirement, education, crypto, multi-asset. Strategies sit on top; they never
// redefine the financial model." Rule 21: a strategy rule is not a user risk
// policy and not a system safety rule.
//
// What this replaces: `FAMILY_POLICY.core / .supporting / .preferredFuture /
// .speculative` — 28 tickers and a 5% cap compiled into `src/lib/data/` —
// driving a "% in approved names" figure on /kids and an "Approved universe"
// paragraph in the committee prompt, with nothing saying whose approval it
// was, and no way for a second user to change it without changing the source.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import {
  BUCKET_LABEL,
  STRATEGY_BUCKETS,
  approvedShare,
  approvedSymbols,
  byBucket,
} from "../strategy";

const sym = (symbol: string, bucket: string) => ({ symbol, bucket });

describe("approvedSymbols", () => {
  test("the set of approved symbols", () => {
    const out = approvedSymbols([sym("MSFT", "core"), sym("GLD", "supporting")]);
    expect(out?.has("MSFT")).toBe(true);
    expect(out?.has("TSLA")).toBe(false);
  });

  test("NO strategy is null, not an empty set", () => {
    // The distinction is the whole point. An empty set answers "is MSFT
    // approved?" with "no", which is a verdict. No list answers it with
    // "nobody has said", which is the truth for a user who has not configured
    // a strategy (rule 13).
    expect(approvedSymbols([])).toBeNull();
  });
});

describe("approvedShare", () => {
  const holdings = [
    { symbol: "MSFT", value: 600 },
    { symbol: "TSLA", value: 400 },
  ];

  test("the share of market value inside the approved list", () => {
    expect(approvedShare(holdings, new Set(["MSFT"]))).toBeCloseTo(0.6, 10);
  });

  test("with no approved universe it is null, NOT 0%", () => {
    // "0% in approved names" is a failing grade issued against a standard
    // nobody wrote. The version this replaces could not express anything else.
    expect(approvedShare(holdings, null)).toBeNull();
  });

  test("an empty account is null, not 0%", () => {
    // The old expression divided by `Math.max(1, mv)`, so an account holding
    // nothing scored 0% against the approved list rather than being unratable.
    expect(approvedShare([], new Set(["MSFT"]))).toBeNull();
    expect(approvedShare([{ symbol: "MSFT", value: 0 }], new Set(["MSFT"]))).toBeNull();
  });

  test("everything approved is 1, nothing approved is 0", () => {
    // 0 IS a real answer when there is a list and the account holds none of
    // it — that is the case the nulls above must not be confused with.
    expect(approvedShare(holdings, new Set(["MSFT", "TSLA"]))).toBe(1);
    expect(approvedShare(holdings, new Set(["AAPL"]))).toBe(0);
  });

  test("NEGATIVE CONTROL: a real share is a number", () => {
    // Without this every null assertion above passes on `() => null`.
    expect(typeof approvedShare(holdings, new Set(["MSFT"]))).toBe("number");
  });
});

describe("byBucket", () => {
  test("declared order, empty buckets skipped", () => {
    const out = byBucket([sym("CLSK", "speculative"), sym("MSFT", "core"), sym("V", "core")]);
    expect(out.map(([b]) => b)).toEqual(["core", "speculative"]);
    expect(out[0][1]).toEqual(["MSFT", "V"]);
  });

  test("an unrecognised bucket is dropped, not given a guessed heading", () => {
    // It can only arrive from a row written before a value was retired or from
    // a hand edit. Inventing a heading is the "everything else is Primary"
    // mistake the account classifier made.
    const out = byBucket([sym("MSFT", "core"), sym("XYZ", "moonshots")]);
    expect(out.flatMap(([, l]) => l)).toEqual(["MSFT"]);
  });

  test("no symbols is no buckets", () => {
    expect(byBucket([])).toEqual([]);
  });

  test("every bucket has a distinct label", () => {
    expect(new Set(Object.values(BUCKET_LABEL)).size).toBe(STRATEGY_BUCKETS.length);
    for (const b of STRATEGY_BUCKETS) expect(BUCKET_LABEL[b]).toBeTruthy();
  });
});

// Rule 16, stated as something a test can check. "Strategies sit on top; they
// never redefine the financial model" means the accounting layer must not
// depend on strategy configuration — not that it currently happens not to.
describe("the accounting core does not know about strategies", () => {
  const ACCOUNTING = [
    "src/lib/accountTotals.ts",
    "src/lib/accountAggregate.ts",
    "src/lib/canonicalBalances.ts",
    "src/lib/reconciliation.ts",
    "src/lib/finance.ts",
    "src/lib/objectiveMath.ts",
    "src/lib/adapters/contract.ts",
    "src/lib/adapters/fidelity.ts",
  ];

  test("no accounting module imports strategy configuration", () => {
    const offenders: string[] = [];
    for (const file of ACCOUNTING) {
      const code = readFileSync(file, "utf8");
      // Imports only — a comment in `objectiveMath.ts` legitimately explains
      // that the strategy moved to `strategy.ts`, and flagging that would
      // pressure the next person to delete the explanation.
      for (const m of code.matchAll(/^\s*import[\s\S]*?from\s+["']([^"']+)["']/gm)) {
        const spec = m[1]!;
        if (/strategy|familyPolicy/i.test(spec)) offenders.push(`${file} imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("NEGATIVE CONTROL: the import scan finds the imports that ARE there", () => {
    // Otherwise a regex that matched no import statement at all would pass.
    const seen: string[] = [];
    for (const m of readFileSync("src/lib/strategy.ts", "utf8").matchAll(
      /^\s*import[\s\S]*?from\s+["']([^"']+)["']/gm,
    )) {
      seen.push(m[1]!);
    }
    expect(seen).toContain("./policy");
  });

  test("NEGATIVE CONTROL: the scan would flag a strategy import", () => {
    const hypothetical = `import { approvedSymbols } from "./strategy";`;
    const m = [...hypothetical.matchAll(/^\s*import[\s\S]*?from\s+["']([^"']+)["']/gm)];
    expect(m).toHaveLength(1);
    expect(/strategy|familyPolicy/i.test(m[0]![1]!)).toBe(true);
  });

  test("every listed accounting module exists", () => {
    // A guard over files that have been renamed away is a guard over nothing —
    // `familyPolicy.ts` was renamed in this very PR.
    for (const file of ACCOUNTING) expect(statSync(file).isFile()).toBe(true);
  });
});

describe("no approved universe is compiled into the source", () => {
  const strip = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  function libSources(dir = "src/lib"): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) {
        if (entry === "__tests__") continue;
        out.push(...libSources(full));
      } else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  // The signature of the defect: a long array literal of short quoted
  // uppercase strings. The same shape `universe.test.ts` looks for on the
  // scanning pages — the four lists removed here were 8, 5, 10 and 1 long.
  const TICKER_ARRAY = /\[\s*(?:"[A-Z][A-Z.]{0,5}"\s*,\s*){4,}/;

  // Two ACTION vocabularies are short quoted uppercase strings and are not
  // ticker lists. `universe.test.ts` already documented this exact false
  // positive on `committeeScorecard.ts`; the fix there was to scope the guard
  // to two files, which is not available here because the point is that the
  // list could come back anywhere. Exempted by NAME rather than by file, and
  // asserted below to still exist, so the exemption cannot outlive its reason.
  const ACTION_WORDS: [string, RegExp][] = [
    ["src/lib/decisionEvidence.ts", /export const RECOMMENDATION_ACTIONS = \[[\s\S]*?\]/],
    ["src/lib/committeeScorecard.ts", /\["BUY", "ADD", "SELL", "TRIM", "HOLD", "WATCH"\]/],
  ];

  const withoutActionWords = (file: string, code: string) =>
    ACTION_WORDS.filter(([f]) => f === file).reduce((c, [, re]) => c.replace(re, "[]"), code);

  test("no lib module holds a ticker list", () => {
    const offenders = libSources().filter((f) =>
      TICKER_ARRAY.test(withoutActionWords(f, strip(readFileSync(f, "utf8")))),
    );
    expect(offenders).toEqual([]);
  });

  test("the action-word exemptions still exist and are still action words", () => {
    // A stale exemption is a hole that outlives its reason. Each pattern must
    // still match its file, and what it removes must not look like tickers to
    // a reader either — so the words themselves are asserted.
    for (const [file, re] of ACTION_WORDS) {
      const code = strip(readFileSync(file, "utf8"));
      const m = code.match(re);
      expect(m).not.toBeNull();
      // Verbs, not symbols. If somebody pasted a ticker list under one of
      // these names the exemption would silently cover it.
      const words = [...m![0].matchAll(/"([A-Z][A-Z.]{0,5})"/g)].map((x) => x[1]!);
      expect(words.length).toBeGreaterThan(3);
      for (const w of words) {
        expect(
          ["BUY", "SELL", "HOLD", "REDUCE", "ADD", "REBALANCE", "ROTATE", "WAIT", "ESCALATE", "TRIM", "WATCH"],
        ).toContain(w);
      }
    }
  });

  test("NEGATIVE CONTROL: removing the action words does not blank the files", () => {
    for (const [file] of ACTION_WORDS) {
      const out = withoutActionWords(file, strip(readFileSync(file, "utf8")));
      expect(out.length).toBeGreaterThan(200);
    }
  });

  test("the kid screens hold none either", () => {
    for (const f of [
      "src/routes/_authenticated/kids.tsx",
      "src/routes/_authenticated/kids-watchlist.tsx",
      "src/routes/_authenticated/kids-prompt-center.tsx",
    ]) {
      expect(TICKER_ARRAY.test(strip(readFileSync(f, "utf8")))).toBe(false);
    }
  });

  test("NEGATIVE CONTROL: the pattern matches the list that was removed", () => {
    const removed = `core: ["MSFT", "AMZN", "GOOGL", "V", "AVGO", "BLK", "ABT", "RY"],`;
    expect(TICKER_ARRAY.test(removed)).toBe(true);
  });

  test("NEGATIVE CONTROL: it spares an ordinary short string array", () => {
    // The bucket vocabulary itself is four quoted lowercase strings and must
    // survive; so must a pair of uppercase constants.
    expect(TICKER_ARRAY.test(`["core", "supporting", "preferred_future", "speculative"]`)).toBe(
      false,
    );
    expect(TICKER_ARRAY.test(`["USD", "EUR"]`)).toBe(false);
  });
});
