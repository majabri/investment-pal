// The old comparison had two outcomes: matches, or differs. "Differs" covered a
// one-cent float artefact and a missing $40,000 position, and a comparison that
// could not be made at all came out as `no-pasted-total` — one case among
// several that all mean "we did not check" for different reasons and need
// different fixes.
import { describe, expect, test } from "bun:test";

import {
  DEFAULT_TOLERANCE,
  reconcileAccount,
  reconciliationHeadline,
  wasChecked,
  type ReconciliationInput,
  type ReconciliationStatus,
} from "../reconciliation";
import type { Provenance } from "../freshness";

const NOW = new Date("2026-09-05T12:00:00Z");
const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const fresh: Provenance = { sourceType: "imported_snapshot", asOf: hoursAgo(1) };
const freshQuotes: Provenance = { sourceType: "live_quote", asOf: hoursAgo(0.1) };

const input = (over: Partial<ReconciliationInput> = {}): ReconciliationInput => ({
  external: { value: 128_450, provenance: fresh },
  calculated: { value: 128_450, positions: fresh, quotes: freshQuotes },
  ...over,
});

const statusOf = (o: Partial<ReconciliationInput> = {}): ReconciliationStatus =>
  reconcileAccount(input(o), DEFAULT_TOLERANCE, NOW).status;

describe("the two numbers are compared, never adjusted", () => {
  test("agreement to the cent reconciles", () => {
    expect(statusOf()).toBe("RECONCILED");
  });

  test("float noise from summing positions is not a finding", () => {
    expect(
      statusOf({ calculated: { value: 128_450.008, positions: fresh, quotes: freshQuotes } }),
    ).toBe("RECONCILED");
  });

  test("the difference is reported with its sign, both ways", () => {
    // The sign says where to look: the app thinking the account is worth MORE
    // than the broker says is a different problem from thinking it worth less.
    const over = reconcileAccount(
      input({ calculated: { value: 130_000, positions: fresh, quotes: freshQuotes } }),
      DEFAULT_TOLERANCE,
      NOW,
    );
    expect(over.differenceUsd).toBeCloseTo(1_550, 2);

    const under = reconcileAccount(
      input({ calculated: { value: 127_000, positions: fresh, quotes: freshQuotes } }),
      DEFAULT_TOLERANCE,
      NOW,
    );
    expect(under.differenceUsd).toBeCloseTo(-1_450, 2);
  });

  test("neither figure is ever changed by the comparison", () => {
    const r = reconcileAccount(
      input({ calculated: { value: 130_000, positions: fresh, quotes: freshQuotes } }),
      DEFAULT_TOLERANCE,
      NOW,
    );
    expect(r.externalEquity).toBe(128_450);
    expect(r.calculatedEquity).toBe(130_000);
  });
});

describe("three bands, because a cent and forty thousand are not the same finding", () => {
  test("above noise but small is a WARNING, not an alarm", () => {
    // $1 on a $128k account: real, unexplained, not worth stopping for.
    expect(
      statusOf({ calculated: { value: 128_451, positions: fresh, quotes: freshQuotes } }),
    ).toBe("WARNING");
  });

  test("a material dollar difference is NOT_RECONCILED", () => {
    expect(
      statusOf({ calculated: { value: 168_450, positions: fresh, quotes: freshQuotes } }),
    ).toBe("NOT_RECONCILED");
  });
});

describe("the thresholds hold at $500 and at $5,000,000 (rule 31)", () => {
  const at = (external: number, calculated: number) =>
    reconcileAccount(
      {
        external: { value: external, provenance: fresh },
        calculated: { value: calculated, positions: fresh, quotes: freshQuotes },
      },
      DEFAULT_TOLERANCE,
      NOW,
    ).status;

  test("a total loss on a small account is material", () => {
    // A dollar threshold alone, set for a large portfolio, would miss this
    // entirely — $500 is under any sane "material dollars" figure.
    expect(at(500, 0)).toBe("NOT_RECONCILED");
  });

  test("a proportionally tiny but large-dollar difference is material", () => {
    // $300 missing from $5m is 0.006% — an order of magnitude BELOW the
    // percentage threshold, so only the dollar one can catch it. It is still
    // three hundred dollars nobody can account for.
    //
    // The first version of this test used $5,000 on $5m, which is 0.1% and
    // therefore already over the percentage threshold — so it passed with the
    // dollar check deleted, and proved nothing. A control caught that.
    const differencePct = 300 / 5_000_000;
    expect(differencePct).toBeLessThan(DEFAULT_TOLERANCE.materialPct);
    expect(at(5_000_000, 4_999_700)).toBe("NOT_RECONCILED");
  });

  test("the same proportion is judged the same way at both scales", () => {
    // 10% out, at either size.
    expect(at(500, 450)).toBe("NOT_RECONCILED");
    expect(at(5_000_000, 4_500_000)).toBe("NOT_RECONCILED");
  });

  test("noise is noise at both scales", () => {
    expect(at(500, 500.005)).toBe("RECONCILED");
    expect(at(5_000_000, 5_000_000.005)).toBe("RECONCILED");
  });

  test("neither threshold is derived from a portfolio's size", () => {
    // The defaults are statements about what counts as money and what counts
    // as a proportion. If either were tuned to one account, this would be the
    // test that noticed.
    expect(DEFAULT_TOLERANCE.materialUsd).toBe(100);
    expect(DEFAULT_TOLERANCE.materialPct).toBe(0.0005);
  });

  test("both are configurable", () => {
    const strict = { noiseUsd: 0, materialUsd: 0.5, materialPct: 0.000001 };
    expect(
      reconcileAccount(
        input({ calculated: { value: 128_450.6, positions: fresh, quotes: freshQuotes } }),
        strict,
        NOW,
      ).status,
    ).toBe("NOT_RECONCILED");
  });
});

describe("not checking is not the same as checking and passing", () => {
  test("a missing broker figure is DATA_INCOMPLETE, and says so", () => {
    const r = reconcileAccount(
      input({ external: { value: null, provenance: fresh } }),
      DEFAULT_TOLERANCE,
      NOW,
    );
    expect(r.status).toBe("DATA_INCOMPLETE");
    expect(r.blockedBy).toEqual(["no broker figure has been imported"]);
  });

  test("a missing app total is DATA_INCOMPLETE for a different reason", () => {
    // Named separately because the fixes differ: one is "import a balance", the
    // other is "this account's cash or margin is not known".
    const r = reconcileAccount(
      input({ calculated: { value: null, positions: fresh, quotes: freshQuotes } }),
      DEFAULT_TOLERANCE,
      NOW,
    );
    expect(r.status).toBe("DATA_INCOMPLETE");
    expect(r.blockedBy[0]).toContain("cannot compute");
  });

  test("an account with no import path is UNSUPPORTED, not incomplete", () => {
    // Different fix again: incomplete means import something, unsupported means
    // there is nothing to import.
    expect(statusOf({ supported: false })).toBe("UNSUPPORTED");
  });

  test("stale inputs are STALE even when the numbers agree", () => {
    // The one that matters most. Two three-month-old figures agreeing is not
    // evidence, and calling it RECONCILED would be the engine vouching for
    // something it has not checked.
    const old: Provenance = { sourceType: "imported_snapshot", asOf: hoursAgo(24 * 90) };
    const r = reconcileAccount(
      input({ external: { value: 128_450, provenance: old } }),
      DEFAULT_TOLERANCE,
      NOW,
    );
    expect(r.status).toBe("STALE");
    expect(r.blockedBy.join(" ")).toContain("broker figure");
  });

  test("stale QUOTES block it too, not just the broker figure", () => {
    // A total is only as current as its stalest component.
    const oldQuotes: Provenance = { sourceType: "live_quote", asOf: hoursAgo(48) };
    expect(
      statusOf({ calculated: { value: 128_450, positions: fresh, quotes: oldQuotes } }),
    ).toBe("STALE");
  });

  test("staleness outranks a material difference", () => {
    // Reporting NOT_RECONCILED on stale data sends someone hunting for a
    // missing position when the answer is "import again".
    const old: Provenance = { sourceType: "imported_snapshot", asOf: hoursAgo(24 * 90) };
    expect(
      reconcileAccount(
        {
          external: { value: 128_450, provenance: old },
          calculated: { value: 200_000, positions: fresh, quotes: freshQuotes },
        },
        DEFAULT_TOLERANCE,
        NOW,
      ).status,
    ).toBe("STALE");
  });

  test("missing data outranks staleness", () => {
    // Nothing to compare beats too old to compare.
    const old: Provenance = { sourceType: "imported_snapshot", asOf: hoursAgo(24 * 90) };
    expect(statusOf({ external: { value: null, provenance: old } })).toBe("DATA_INCOMPLETE");
  });
});

describe("a percentage of nothing is undefined, not zero", () => {
  test("an account the broker reports as worth zero has no percentage", () => {
    const r = reconcileAccount(
      {
        external: { value: 0, provenance: fresh },
        calculated: { value: 50, positions: fresh, quotes: freshQuotes },
      },
      DEFAULT_TOLERANCE,
      NOW,
    );
    expect(r.differencePct).toBeNull();
    // ...and it still reconciles by the dollar comparison, rather than falling
    // through a hole because one branch could not be evaluated.
    expect(r.status).toBe("WARNING");
  });
});

describe("every state says something, and only three claim a check happened", () => {
  const all: ReconciliationStatus[] = [
    "RECONCILED",
    "WARNING",
    "NOT_RECONCILED",
    "DATA_INCOMPLETE",
    "STALE",
    "UNSUPPORTED",
    "ERROR",
  ];

  test("no status renders as an empty headline", () => {
    for (const status of all) {
      const r = reconcileAccount(input(), DEFAULT_TOLERANCE, NOW);
      expect(reconciliationHeadline({ ...r, status }).length).toBeGreaterThan(0);
    }
  });

  test("only the three comparison outcomes count as checked", () => {
    expect(all.filter(wasChecked)).toEqual(["RECONCILED", "WARNING", "NOT_RECONCILED"]);
  });

  test("no unchecked status reads as reassurance", () => {
    for (const status of all.filter((s) => !wasChecked(s))) {
      const r = reconcileAccount(input(), DEFAULT_TOLERANCE, NOW);
      const text = reconciliationHeadline({ ...r, status }).toLowerCase();
      expect(text).not.toContain("matches");
      expect(text).not.toContain("reconciled —");
    }
  });
});
