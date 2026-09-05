// Phase 5, rule 18: AI is downstream.
//
// "AI may analyse, flag inconsistencies, and recommend. It may NEVER be the
// source of account equity, cash, margin debt, position quantity, cost basis,
// buying power, open orders, fills, balances, or transaction history. Add
// tests asserting AI output cannot write to financial fields."
//
// The app was compliant by accident: the one place an AI response becomes a
// row — the Action Sheet extractor — happens to write only recommendation
// columns. Nothing prevented the next person adding `cash: parsedFromResponse`
// to that payload, and nothing would have noticed. A model told the cash
// balance is NOT KNOWN will helpfully estimate one, and an estimate written
// into `accounts.cash` is indistinguishable from an imported figure the moment
// it lands.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import {
  AI_WRITABLE_TABLES,
  AiBoundaryError,
  FINANCIAL_TRUTH_FIELDS,
  PROVENANCE_EXEMPT,
  assertAiWritable,
} from "../aiBoundary";

describe("assertAiWritable", () => {
  test("a recommendation row passes", () => {
    expect(() =>
      assertAiWritable("decisions", {
        user_id: "u1",
        symbol: "MSFT",
        recommendation: "BUY: add on weakness",
        action: "BUY",
        confidence: 0.7,
        decision: "pending",
      }),
    ).not.toThrow();
  });

  test("every financial-truth field is refused", () => {
    // Exhaustive over the list rather than a sample: a field added to the list
    // and forgotten in the check would be the whole defect.
    for (const field of FINANCIAL_TRUTH_FIELDS) {
      expect(() => assertAiWritable("decisions", { [field]: 1234 })).toThrow(AiBoundaryError);
    }
  });

  test("the error names the offending field", () => {
    // "Write rejected" sends the next person reading the source; naming the
    // field sends them to the line.
    try {
      assertAiWritable("decisions", { cash: 5000, margin_used: 100 });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("cash");
      expect((e as Error).message).toContain("margin_used");
      expect((e as Error).message).toContain("Rule 18");
    }
  });

  test("a table outside the allowlist is refused, whatever the row holds", () => {
    // The tighter of the two checks: it is not enough that the columns look
    // harmless. `accounts` is never an AI destination.
    for (const table of ["accounts", "holdings", "account_balances", "portfolio_snapshots"]) {
      expect(() => assertAiWritable(table, { note: "hello" })).toThrow(AiBoundaryError);
    }
  });

  test("it throws rather than filtering", () => {
    // A filter would leave the caller believing the field was saved, and the
    // user believing a figure on screen came from their broker.
    const row = { cash: 5000 };
    expect(() => assertAiWritable("decisions", row)).toThrow();
    expect(row).toEqual({ cash: 5000 });
  });

  test("NEGATIVE CONTROL: the allowed tables really are allowed", () => {
    // Without this, `assertAiWritable = () => { throw }` would satisfy every
    // rejection assertion above.
    for (const t of AI_WRITABLE_TABLES) {
      expect(() => assertAiWritable(t, { body: "text" })).not.toThrow();
    }
  });

  test("an empty row is not a way past the check", () => {
    expect(() => assertAiWritable("accounts", {})).toThrow(AiBoundaryError);
  });
});

describe("the provenance exemptions", () => {
  test("each is a real column on an allowed table, with an argument", () => {
    // A stale exemption is a hole that outlives its reason — the lesson from
    // the personal-data allowlist.
    for (const e of PROVENANCE_EXEMPT) {
      expect(AI_WRITABLE_TABLES as readonly string[]).toContain(e.table);
      expect(e.why.length).toBeGreaterThan(20);
    }
  });

  test("no exemption silently duplicates a forbidden field", () => {
    // If a column were both exempt and forbidden the two lists would
    // disagree, and which one won would depend on read order.
    for (const e of PROVENANCE_EXEMPT) {
      expect(FINANCIAL_TRUTH_FIELDS as readonly string[]).not.toContain(e.column);
    }
  });

  test("price_at_rec is permitted, and is not AI-derived at the call site", () => {
    // The one case worth understanding: `decisions.price_at_rec` IS a price.
    // It is allowed because the extractor reads it from the live quote map,
    // not from the response text — asserted against the source below.
    expect(() =>
      assertAiWritable("decisions", { symbol: "MSFT", price_at_rec: 401.22 }),
    ).not.toThrow();
    const src = readFileSync("src/routes/_authenticated/prompt-center.tsx", "utf8");
    expect(src).toMatch(/price_at_rec:\s*a\.symbol\s*\?\s*\(?liveQuotes/);
  });
});

// The runtime check only fires where it is called. This is the half that says
// it is called everywhere it needs to be.
describe("every AI-derived write goes through the boundary", () => {
  const strip = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  function sources(dir = "src"): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) {
        if (entry === "__tests__") continue;
        out.push(...sources(full));
      } else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  /**
   * A file "handles an AI response" if it names one of the variables that
   * holds model output. Crude, and sufficient: the point is to catch a NEW
   * surface that starts writing, and a new surface will hold the response in
   * something named like these.
   */
  const AI_RESPONSE_MARKERS = /\baiResponse\b|\bcommitteeResponse\b|\bmodelResponse\b/;
  const WRITE = /\.from\(\s*["']([a-z_]+)["'](?:\s+as\s+never)?\s*\)[\s\S]{0,80}?\.(insert|update|upsert)\(/g;

  test("files that handle a model response write only to allowed tables", () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      const code = strip(readFileSync(file, "utf8"));
      if (!AI_RESPONSE_MARKERS.test(code)) continue;
      for (const m of code.matchAll(WRITE)) {
        const table = m[1]!;
        if (!(AI_WRITABLE_TABLES as readonly string[]).includes(table)) {
          offenders.push(`${file} writes to ${table}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("and call the boundary before doing it", () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      const code = strip(readFileSync(file, "utf8"));
      if (!AI_RESPONSE_MARKERS.test(code)) continue;
      if (![...code.matchAll(WRITE)].length) continue;
      if (!/assertAiWritable\(/.test(code)) offenders.push(`${file} writes without the boundary`);
    }
    expect(offenders).toEqual([]);
  });

  test("NEGATIVE CONTROL: the scan finds the write that IS there", () => {
    // Both assertions above pass vacuously if the marker or the write pattern
    // matches nothing. This pins that they match the one real call site.
    const code = strip(readFileSync("src/routes/_authenticated/prompt-center.tsx", "utf8"));
    expect(AI_RESPONSE_MARKERS.test(code)).toBe(true);
    const writes = [...code.matchAll(WRITE)].map((m) => m[1]);
    expect(writes).toContain("decisions");
    expect(code).toContain("assertAiWritable(");
  });

  test("NEGATIVE CONTROL: the write pattern would flag a forbidden table", () => {
    const hypothetical = `await supabase.from("accounts").update({ cash: parsed })`;
    const m = [...hypothetical.matchAll(WRITE)];
    expect(m).toHaveLength(1);
    expect(m[0]![1]).toBe("accounts");
    expect(AI_WRITABLE_TABLES as readonly string[]).not.toContain(m[0]![1]!);
  });
});
