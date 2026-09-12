// §12.4 and BR-010, built around the blueprint's own worked example.
//
// "A 50-share core holding plus a new 10-share tactical trade may display as 60
// aggregate shares, but the 10-share tactical tranche must remain separately
// identifiable for lifecycle, attribution and exit logic."
//
// That example was unrepresentable: `position_lots` answers tax questions —
// cost basis, holding period — and nothing answered "which decision opened
// this, and when does it close".
import { describe, expect, test } from "bun:test";

import {
  aggregationNote,
  exitCandidates,
  isOpen,
  symbolPosition,
  trancheCoverage,
} from "@/lib/tranches";
import type { Tranche } from "@/lib/tranches";

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

// The blueprint's example, with a synthetic symbol.
const CORE = tranche({ id: "core-1", kind: "core", opened_quantity: 50 });
const TACTICAL = tranche({
  id: "tac-1",
  kind: "tactical",
  opened_quantity: 10,
  opened_at: "2026-09-01T00:00:00Z",
  decision_id: "dec-1",
});

describe("the blueprint's 50 + 10 example", () => {
  test("it displays as 60 aggregate shares", () => {
    const p = symbolPosition("AAA", [CORE, TACTICAL]);
    expect(p.aggregate).toBe(60);
  });

  test("and the 10 stays separately identifiable", () => {
    // The half that was impossible before. Without this the position is a
    // single number and "close the tactical piece" is arithmetic done by hand.
    const p = symbolPosition("AAA", [CORE, TACTICAL]);
    expect(p.byKind).toEqual({ core: 50, tactical: 10 });
    expect(p.open.map((t) => t.id)).toEqual(["tac-1", "core-1"]);
  });

  test("closing the tactical piece leaves the core untouched", () => {
    const closed = { ...TACTICAL, closed_at: "2026-09-10T00:00:00Z" };
    const p = symbolPosition("AAA", [CORE, closed]);
    expect(p.aggregate).toBe(50);
    expect(p.byKind).toEqual({ core: 50 });
    expect(isOpen(closed)).toBe(false);
    expect(isOpen(CORE)).toBe(true);
  });

  test("the tranche remembers which decision opened it", () => {
    // §A.3's chain from decision to execution, as a foreign key rather than a
    // reconstruction from dates and symbols.
    expect(TACTICAL.decision_id).toBe("dec-1");
  });
});

describe("symbolPosition", () => {
  test("NEGATIVE CONTROL: one tranche aggregates to itself", () => {
    expect(symbolPosition("AAA", [CORE]).aggregate).toBe(50);
  });

  test("another symbol's tranches are not counted", () => {
    const other = tranche({ id: "b", symbol: "BBB", opened_quantity: 999 });
    expect(symbolPosition("AAA", [CORE, other]).aggregate).toBe(50);
  });

  test("a kind with no open tranche is ABSENT, not zero", () => {
    // Zero would read as "a tactical position of no shares", which is a
    // different claim from "there is no tactical position".
    const p = symbolPosition("AAA", [CORE]);
    expect(p.byKind.tactical).toBeUndefined();
    expect("tactical" in p.byKind).toBe(false);
  });

  test("an unusable quantity makes the aggregate unknown", () => {
    const bad = tranche({ id: "x", opened_quantity: Number.NaN });
    expect(symbolPosition("AAA", [CORE, bad]).aggregate).toBeNull();
  });

  test("open tranches come back newest first", () => {
    const older = tranche({ id: "old", opened_at: "2020-01-01T00:00:00Z" });
    expect(symbolPosition("AAA", [older, TACTICAL]).open.map((t) => t.id)).toEqual([
      "tac-1",
      "old",
    ]);
  });
});

describe("trancheCoverage", () => {
  test("no tranches is NOT_RECORDED, not a discrepancy", () => {
    // Nobody has recorded lifecycle for this holding. That is different from
    // recording it wrongly, and flagging it as a mismatch would put a warning
    // on every position in the account on day one.
    expect(trancheCoverage([], 60)).toBe("not_recorded");
  });

  test("NEGATIVE CONTROL: agreement is matched", () => {
    expect(trancheCoverage([CORE, TACTICAL], 60)).toBe("matched");
  });

  test("fractional agreement inside the epsilon still matches", () => {
    expect(trancheCoverage([CORE, TACTICAL], 60.00001)).toBe("matched");
  });

  test("more tranche than holding is over; less is under", () => {
    expect(trancheCoverage([CORE, TACTICAL], 55)).toBe("over");
    expect(trancheCoverage([CORE, TACTICAL], 70)).toBe("under");
  });

  test("an unknown holding quantity is unknown, not a mismatch", () => {
    expect(trancheCoverage([CORE], null)).toBe("unknown");
  });

  test("closed tranches do not count against the holding", () => {
    const closed = { ...TACTICAL, closed_at: "2026-09-10T00:00:00Z" };
    expect(trancheCoverage([CORE, closed], 50)).toBe("matched");
  });
});

describe("exitCandidates", () => {
  test("newest first, within the kind", () => {
    // Not FIFO, and deliberately not a tax-lot selection: this answers "which
    // tactical trade am I closing", and the newest open one is what a person
    // means by the position they just put on.
    const older = tranche({ id: "tac-0", kind: "tactical", opened_at: "2026-02-01T00:00:00Z" });
    expect(exitCandidates([CORE, older, TACTICAL], "tactical").map((t) => t.id)).toEqual([
      "tac-1",
      "tac-0",
    ]);
  });

  test("it never offers the other kind", () => {
    // Closing "the tactical piece" must not reach into the core holding.
    expect(exitCandidates([CORE, TACTICAL], "tactical").map((t) => t.id)).toEqual(["tac-1"]);
    expect(exitCandidates([CORE, TACTICAL], "core").map((t) => t.id)).toEqual(["core-1"]);
  });

  test("closed tranches are not candidates", () => {
    const closed = { ...TACTICAL, closed_at: "2026-09-10T00:00:00Z" };
    expect(exitCandidates([closed], "tactical")).toEqual([]);
  });
});

describe("aggregationNote", () => {
  test("it explains a mixed row", () => {
    const note = aggregationNote(symbolPosition("AAA", [CORE, TACTICAL]));
    expect(note).toContain("60 shares shown");
    expect(note).toContain("50 core");
    expect(note).toContain("10 tactical");
    expect(note).toContain("closes separately");
  });

  test("a single kind gets NO note", () => {
    // A caption on every row is a caption nobody reads.
    expect(aggregationNote(symbolPosition("AAA", [CORE]))).toBeNull();
  });
});
