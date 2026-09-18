// How the tranches panel says things (§12.4, BR-010).
import { describe, expect, test } from "bun:test";

import type { Tranche } from "@/lib/tranches";
import type { DecisionOption } from "@/lib/tranchesView";
import {
  KIND_LABEL,
  coverageLines,
  decisionOptionLabel,
  rankDecisionOptions,
  coverageSentence,
  fmtQuantity,
  sortTranches,
  trancheSummary,
} from "@/lib/tranchesView";

const tranche = (over: Partial<Tranche> = {}): Tranche => ({
  id: "t1",
  account_id: "acct-1",
  symbol: "AAA",
  security_id: null,
  kind: "core",
  decision_id: null,
  opened_at: "2026-01-15T00:00:00Z",
  closed_at: null,
  opened_quantity: 50,
  target: null,
  invalidation: null,
  ...over,
});

describe("sortTranches", () => {
  test("open first (newest opened first), then closed (newest closed first)", () => {
    const a = tranche({ id: "old-open", opened_at: "2026-01-01T00:00:00Z" });
    const b = tranche({ id: "new-open", opened_at: "2026-03-01T00:00:00Z" });
    const c = tranche({ id: "closed-early", opened_at: "2025-01-01T00:00:00Z", closed_at: "2026-02-01T00:00:00Z" });
    const d = tranche({ id: "closed-late", opened_at: "2025-06-01T00:00:00Z", closed_at: "2026-04-01T00:00:00Z" });
    expect(sortTranches([c, a, d, b]).map((t) => t.id)).toEqual(["new-open", "old-open", "closed-late", "closed-early"]);
  });

  test("NEGATIVE CONTROL: does not mutate its input", () => {
    const rows = [tranche({ id: "b", opened_at: "2026-02-01T00:00:00Z" }), tranche({ id: "a", opened_at: "2026-03-01T00:00:00Z" })];
    sortTranches(rows);
    expect(rows.map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("coverageSentence", () => {
  test("NEGATIVE CONTROL: matched says nothing", () => {
    expect(coverageSentence("AAA", "matched", 50, 50)).toBeNull();
  });

  test("not_recorded is said — it is the state the panel exists to change", () => {
    expect(coverageSentence("AAA", "not_recorded", null, 50)).toContain("no tranche recorded");
  });

  test("over and under carry both figures", () => {
    const over = coverageSentence("AAA", "over", 60, 50)!;
    expect(over).toContain("60");
    expect(over).toContain("50");
    expect(over).toContain("More is recorded than held");
    const under = coverageSentence("AAA", "under", 40, 50)!;
    expect(under).toContain("40");
    expect(under).toContain("no tranche");
  });

  test("unknown says it cannot be stated — not zero, not matched", () => {
    expect(coverageSentence("AAA", "unknown", null, null)).toContain("cannot be stated");
  });
});

describe("coverageLines", () => {
  const holdings = [
    { symbol: "CCC", quantity: 10 },
    { symbol: "AAA", quantity: 60 },
    { symbol: "BBB", quantity: 20 },
  ];
  const tranches = [
    tranche({ id: "a1", symbol: "AAA", opened_quantity: 50 }),
    tranche({ id: "a2", symbol: "AAA", kind: "tactical", opened_quantity: 10 }),
    tranche({ id: "b1", symbol: "BBB", opened_quantity: 15 }),
    // Closed: must not count toward BBB's recorded quantity.
    tranche({ id: "b0", symbol: "BBB", opened_quantity: 5, closed_at: "2026-02-01T00:00:00Z" }),
  ];

  test("one line per non-matched holding, sorted by symbol; matched omitted", () => {
    const lines = coverageLines(holdings, tranches);
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith("BBB:")).toBe(true);
    expect(lines[0]).toContain("15");
    expect(lines[1].startsWith("CCC:")).toBe(true);
    expect(lines[1]).toContain("no tranche recorded");
  });

  test("NEGATIVE CONTROL: every holding matched yields no lines", () => {
    expect(coverageLines([{ symbol: "AAA", quantity: 60 }], tranches)).toEqual([]);
  });
});

describe("trancheSummary", () => {
  const holdings = [{ symbol: "AAA" }, { symbol: "BBB" }, { symbol: "CCC" }];

  test("no tranches at all is said as such", () => {
    expect(trancheSummary(holdings, [])).toContain("No tranches recorded");
  });

  test("counts open, covered holdings, and closed", () => {
    const s = trancheSummary(holdings, [
      tranche({ id: "1", symbol: "AAA" }),
      tranche({ id: "2", symbol: "AAA", kind: "tactical" }),
      tranche({ id: "3", symbol: "BBB", closed_at: "2026-02-01T00:00:00Z" }),
    ]);
    expect(s).toBe("2 open tranches across 1 of 3 holdings; 1 closed.");
  });

  test("singular forms", () => {
    expect(trancheSummary([{ symbol: "AAA" }], [tranche()])).toBe("1 open tranche across 1 of 1 holding; 0 closed.");
  });
});

describe("labels", () => {
  test("both kinds have a label", () => {
    expect(KIND_LABEL.core).toBe("Core");
    expect(KIND_LABEL.tactical).toBe("Tactical");
  });
  test("a null quantity is a dash, never 0", () => {
    expect(fmtQuantity(null)).toBe("—");
    expect(fmtQuantity(12.5)).toBe("12.5");
  });
});

describe("decision options for the tranche form (§A.3)", () => {
  const d = (over: Partial<DecisionOption> = {}): DecisionOption => ({
    id: "d1",
    decided_on: "2026-09-12",
    symbol: "AAA",
    action: "ADD",
    recommendation: "Add a tactical tranche into the pullback.",
    decision: "followed",
    ...over,
  });

  test("the label carries date, action, symbol, disposition and the recommendation", () => {
    expect(decisionOptionLabel(d())).toBe("2026-09-12 · ADD AAA · followed — Add a tactical tranche into the pullback.");
  });

  test("a portfolio-level decision has no symbol and the label does not invent one", () => {
    expect(decisionOptionLabel(d({ symbol: null, action: "REDUCE" }))).toBe("2026-09-12 · REDUCE · followed — Add a tactical tranche into the pullback.");
    expect(decisionOptionLabel(d({ symbol: null, action: null }))).toBe("2026-09-12 · followed — Add a tactical tranche into the pullback.");
  });

  test("a long recommendation is cut with an ellipsis, and the label stays one line", () => {
    const label = decisionOptionLabel(d({ recommendation: "x".repeat(200) }));
    expect(label.length).toBeLessThanOrEqual(96);
    expect(label.endsWith("…")).toBe(true);
  });

  test("the draft's symbol ranks first, newest first within each group; nothing is dropped", () => {
    const ranked = rankDecisionOptions(
      [
        d({ id: "old-other", symbol: "BBB", decided_on: "2026-09-01" }),
        d({ id: "old-same", symbol: "AAA", decided_on: "2026-08-01" }),
        d({ id: "new-other", symbol: "BBB", decided_on: "2026-09-15" }),
        d({ id: "new-same", symbol: "aaa", decided_on: "2026-09-10" }),
        d({ id: "portfolio", symbol: null, decided_on: "2026-09-16" }),
      ],
      " aaa ",
    );
    expect(ranked.map((x) => x.id)).toEqual(["new-same", "old-same", "portfolio", "new-other", "old-other"]);
  });

  test("NEGATIVE CONTROL: with no symbol typed, the order is simply newest first", () => {
    const ranked = rankDecisionOptions(
      [d({ id: "a", decided_on: "2026-09-01" }), d({ id: "b", symbol: "BBB", decided_on: "2026-09-15" })],
      "",
    );
    expect(ranked.map((x) => x.id)).toEqual(["b", "a"]);
  });
});
