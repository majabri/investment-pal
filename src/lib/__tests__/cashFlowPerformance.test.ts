// Flow coverage, and what `performance()` is allowed to claim without it.
//
// The trap: an account with no cash-flow rows looks exactly like an account
// with no cash flows. Computing a time-weighted return under the second reading
// when the first is true reproduces PERF-001 with a better name on it — so
// coverage is driven by `accounts.cash_flows_as_of`, not by the row count.
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TREATMENT,
  KIND_LABEL,
  canRecordFlow,
  coverageAfterRecording,
  emptyDraft,
  externalFlows,
  flowCoverage,
  flowInsert,
  netExternalFlow,
  validateFlow,
} from "@/lib/cashFlows";
import type { FlowDraft } from "@/lib/cashFlows";
import type { CashFlowRow } from "@/lib/cashFlows";
import { METHOD_LABEL, balanceSeries, moneyWeighted, performance } from "@/lib/portfolioSummary";

// Synthetic (ADR-APP-012 rules 23-25): 100,000 flat, 10,000 deposited mid-month.
const snapshots = [
  {
    created_at: "2026-01-01T10:00:00Z",
    snapshot_date: "2026-01-01",
    gross: 100_000,
    net: 100_000,
    margin_used: 0,
  },
  {
    created_at: "2026-01-14T10:00:00Z",
    snapshot_date: "2026-01-14",
    gross: 100_000,
    net: 100_000,
    margin_used: 0,
  },
  {
    created_at: "2026-01-15T10:00:00Z",
    snapshot_date: "2026-01-15",
    gross: 110_000,
    net: 110_000,
    margin_used: 0,
  },
  {
    created_at: "2026-01-31T10:00:00Z",
    snapshot_date: "2026-01-31",
    gross: 110_000,
    net: 110_000,
    margin_used: 0,
  },
];
const series = balanceSeries(snapshots);
const deposit: CashFlowRow[] = [
  { flow_date: "2026-01-15", amount: 10_000, kind: "deposit", treatment: "external" },
];
const allTime = [{ label: "All time", kind: "all" as const }];

describe("flowCoverage", () => {
  test("no as_of is UNKNOWN, however many rows there are", () => {
    expect(flowCoverage(null, 0)).toBe("unknown");
    expect(flowCoverage(null, 5)).toBe("unknown");
    expect(flowCoverage(undefined, 0)).toBe("unknown");
    expect(flowCoverage("", 3)).toBe("unknown");
  });

  test("an as_of with no rows is NONE — a positive fact, not an absence", () => {
    expect(flowCoverage("2026-01-31T00:00:00Z", 0)).toBe("none");
  });

  test("an as_of with rows is KNOWN", () => {
    expect(flowCoverage("2026-01-31T00:00:00Z", 2)).toBe("known");
  });
});

describe("performance() under an unknown flow history", () => {
  const entries = performance(series, allTime);

  test("reports no return at all — never the value change dressed as one", () => {
    expect(entries[0].returnPct).toBeNull();
    expect(entries[0].method).toBe("value_change");
    expect(entries[0].netFlow).toBeNull();
  });

  test("still reports the change in value, which is what it actually knows", () => {
    expect(entries[0].change).toBe(10_000);
    expect(entries[0].changePct).toBeCloseTo(0.1, 10);
  });

  test("the label says it is not a return", () => {
    expect(METHOD_LABEL[entries[0].method]).toContain("not a return");
  });

  test("this is the default, so no caller can get a return by forgetting", () => {
    // `performance(series)` with no flow argument at all.
    expect(performance(series)[0].returnPct).toBeNull();
  });
});

describe("performance() with a known flow history", () => {
  const entries = performance(series, allTime, { coverage: "known", rows: deposit });

  test("the deposit stops being return: +10.0% becomes 0.0%", () => {
    expect(entries[0].changePct).toBeCloseTo(0.1, 10); // what it used to report
    expect(entries[0].returnPct).toBeCloseTo(0, 10); // what actually happened
    expect(entries[0].method).toBe("twr");
  });

  test("the flow itself is reported, so the difference can be checked", () => {
    expect(entries[0].netFlow).toBe(10_000);
  });

  test("coverage 'none' computes a real return — nothing crossed the boundary", () => {
    const e = performance(series, allTime, { coverage: "none", rows: [] })[0];
    expect(e.method).toBe("twr");
    expect(e.returnPct).toBeCloseTo(0.1, 10);
    expect(e.netFlow).toBe(0);
  });

  test("an internal flow is NOT removed from return", () => {
    // A dividend left in the account IS return. Subtracting it would understate
    // performance by exactly the dividend.
    const rows: CashFlowRow[] = [
      { flow_date: "2026-01-15", amount: 10_000, kind: "dividend", treatment: "internal" },
    ];
    const e = performance(series, allTime, { coverage: "known", rows })[0];
    expect(e.netFlow).toBe(0);
    expect(e.returnPct).toBeCloseTo(0.1, 10);
  });
});

describe("the whole chain, from the account row to the reported figure", () => {
  // The integration the two halves above do not cover on their own: coverage
  // derived from `accounts.cash_flows_as_of` and fed straight into
  // `performance()`. This is where PERF-001 would come back — a `null` as_of
  // read as "no flows" would compute a real-looking return from an absence.
  const run = (asOf: string | null, rows: CashFlowRow[]) =>
    performance(series, allTime, { coverage: flowCoverage(asOf, rows.length), rows })[0];

  test("an account nobody has told gets NO return, whatever rows exist", () => {
    expect(run(null, []).returnPct).toBeNull();
    expect(run(null, []).method).toBe("value_change");
    // Rows without an as_of are a partial import, not a history.
    expect(run(null, deposit).returnPct).toBeNull();
    expect(run(null, deposit).method).toBe("value_change");
  });

  test("an account somebody HAS told gets a return, and the deposit is out of it", () => {
    const e = run("2026-01-31T00:00:00Z", deposit);
    expect(e.method).toBe("twr");
    expect(e.returnPct).toBeCloseTo(0, 10);
    // The figure it replaces, still reported, still +10%.
    expect(e.changePct).toBeCloseTo(0.1, 10);
  });

  test("told, and genuinely no flows, is a real 10% return", () => {
    const e = run("2026-01-31T00:00:00Z", []);
    expect(e.method).toBe("twr");
    expect(e.returnPct).toBeCloseTo(0.1, 10);
  });
});

describe("moneyWeighted", () => {
  test("null under an unknown flow history, exactly as TWR is", () => {
    const entry = performance(series, allTime)[0];
    expect(moneyWeighted(series, entry, { coverage: "unknown", rows: deposit })).toBeNull();
  });

  test("a deposit into a flat account earns nothing on a money basis either", () => {
    const flows = { coverage: "known" as const, rows: deposit };
    const entry = performance(series, allTime, flows)[0];
    const mwr = moneyWeighted(series, entry, flows);
    expect(mwr).not.toBeNull();
    expect(mwr!).toBeCloseTo(0, 6);
  });

  test("its label says it is annualised, because it is and TWR is not", () => {
    expect(METHOD_LABEL.mwr).toContain("annualised");
    expect(METHOD_LABEL.twr).not.toContain("annualised");
  });
});

describe("the flow model", () => {
  test("externalFlows drops internal rows and sorts by date", () => {
    const rows: CashFlowRow[] = [
      { flow_date: "2026-03-01", amount: 500, kind: "deposit", treatment: "external" },
      { flow_date: "2026-01-01", amount: 100, kind: "dividend", treatment: "internal" },
      { flow_date: "2026-02-01", amount: -200, kind: "withdrawal", treatment: "external" },
    ];
    expect(externalFlows(rows)).toEqual([
      { date: "2026-02-01", amount: -200 },
      { date: "2026-03-01", amount: 500 },
    ]);
  });

  test("netExternalFlow is half-open — a flow on the opening date is excluded", () => {
    const rows: CashFlowRow[] = [
      { flow_date: "2026-01-01", amount: 1_000, kind: "deposit", treatment: "external" },
      { flow_date: "2026-01-15", amount: 2_000, kind: "deposit", treatment: "external" },
      { flow_date: "2026-01-31", amount: 4_000, kind: "deposit", treatment: "external" },
    ];
    // The opening date's flow is already inside the opening value.
    expect(netExternalFlow(rows, "2026-01-01", "2026-01-31")).toBe(6_000);
  });

  test("a retained dividend defaults to internal, a deposit to external", () => {
    expect(DEFAULT_TREATMENT.dividend).toBe("internal");
    expect(DEFAULT_TREATMENT.fee).toBe("internal");
    expect(DEFAULT_TREATMENT.interest).toBe("internal");
    expect(DEFAULT_TREATMENT.deposit).toBe("external");
    expect(DEFAULT_TREATMENT.withdrawal).toBe("external");
  });

  test("every kind has a label", () => {
    for (const kind of Object.keys(DEFAULT_TREATMENT) as (keyof typeof DEFAULT_TREATMENT)[]) {
      expect(KIND_LABEL[kind].length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// The write side (PERF-001). Until this existed the table was unreachable.
// ---------------------------------------------------------------------------

describe("validateFlow — the sign is not a matter of opinion", () => {
  const ok = (over: Partial<FlowDraft> = {}): FlowDraft => ({
    flowDate: "2026-09-01",
    kind: "deposit",
    amount: 5_000,
    treatment: "external",
    symbol: null,
    note: null,
    ...over,
  });

  test("NEGATIVE CONTROL: a good draft is accepted", () => {
    // Without this, every refusal below passes on a validator that refuses all.
    expect(validateFlow(ok())).toEqual([]);
    expect(canRecordFlow(ok())).toBe(true);
  });

  test("a negative deposit is named as a withdrawal typed in the wrong box", () => {
    const p = validateFlow(ok({ amount: -5_000 }));
    expect(p).toHaveLength(1);
    expect(p[0].field).toBe("amount");
    // The message has to say what to do, not that the input is invalid: this
    // is the one mistake here that inverts a return silently.
    expect(p[0].message).toContain("Withdrawal");
  });

  test("a positive withdrawal is refused the same way", () => {
    const p = validateFlow(ok({ kind: "withdrawal", amount: 5_000 }));
    expect(p[0].message).toContain("Deposit");
  });

  test("a correctly signed withdrawal is accepted", () => {
    expect(validateFlow(ok({ kind: "withdrawal", amount: -5_000 }))).toEqual([]);
  });

  test("fee and interest are NOT sign-constrained", () => {
    // A fee rebate is a real positive flow; refusing it would push it into the
    // return instead. Mirrors the CHECK, which constrains only the two kinds
    // that go one way.
    expect(validateFlow(ok({ kind: "fee", amount: 120 }))).toEqual([]);
    expect(validateFlow(ok({ kind: "fee", amount: -120 }))).toEqual([]);
    expect(validateFlow(ok({ kind: "interest", amount: -40 }))).toEqual([]);
    expect(validateFlow(ok({ kind: "dividend", amount: -75 }))).toEqual([]);
  });

  test("zero is not a flow", () => {
    expect(validateFlow(ok({ amount: 0 }))[0].field).toBe("amount");
  });

  test("an empty amount is missing, not zero", () => {
    expect(validateFlow(ok({ amount: null }))[0].message).toContain("Enter the amount");
  });

  test("a date that is not a real calendar day is refused", () => {
    expect(validateFlow(ok({ flowDate: "2026-02-31" }))[0].field).toBe("flowDate");
    expect(validateFlow(ok({ flowDate: "" }))[0].field).toBe("flowDate");
  });

  test("a future date is refused — a plan is not a flow", () => {
    const p = validateFlow(ok({ flowDate: "2099-01-01" }));
    expect(p[0].field).toBe("flowDate");
    expect(p[0].message).toContain("future");
  });

  test("a blank symbol is refused, an absent one is fine", () => {
    expect(validateFlow(ok({ symbol: "   " }))[0].field).toBe("symbol");
    expect(validateFlow(ok({ symbol: null }))).toEqual([]);
  });
});

describe("flowInsert", () => {
  const draft: FlowDraft = {
    flowDate: "2026-09-01",
    kind: "dividend",
    amount: 250,
    treatment: "external",
    symbol: "  abc  ",
    note: "  swept out  ",
  };

  test("it writes the treatment CHOSEN, never one derived from the kind", () => {
    // DEFAULT_TREATMENT says a dividend is internal. This draft says external,
    // because it was swept to a bank account — and only the holder knows that.
    expect(DEFAULT_TREATMENT.dividend).toBe("internal");
    const row = flowInsert({ userId: "u1", accountId: "a1", draft });
    expect(row.treatment).toBe("external");
  });

  test("blank-ish optional text becomes NULL, not an empty string", () => {
    const row = flowInsert({ userId: "u1", accountId: "a1", draft: { ...draft, symbol: "  ", note: "" } });
    expect(row.symbol).toBeNull();
    expect(row.note).toBeNull();
  });

  test("symbol and note are trimmed", () => {
    const row = flowInsert({ userId: "u1", accountId: "a1", draft });
    expect(row.symbol).toBe("abc");
    expect(row.note).toBe("swept out");
  });

  test("source defaults to user_entry and is never an AI value", () => {
    expect(flowInsert({ userId: "u1", accountId: "a1", draft }).source).toBe("user_entry");
    expect(flowInsert({ userId: "u1", accountId: "a1", draft, source: "imported" }).source).toBe(
      "imported",
    );
  });
});

describe("recording a flow does not claim the history is complete", () => {
  test("rows alone never promote coverage off unknown", () => {
    // The trap PERF-001 exists to avoid. A partial import produces rows too,
    // and a return computed over a partial history is wrong by what is missing.
    expect(coverageAfterRecording(null, 1)).toBe("unknown");
    expect(coverageAfterRecording(null, 40)).toBe("unknown");
  });

  test("only the account's as-of stamp promotes it", () => {
    expect(coverageAfterRecording("2026-09-11T00:00:00Z", 0)).toBe("none");
    expect(coverageAfterRecording("2026-09-11T00:00:00Z", 3)).toBe("known");
  });
});

describe("emptyDraft", () => {
  test("it suggests the kind's default treatment", () => {
    expect(emptyDraft("2026-09-11", "dividend").treatment).toBe("internal");
    expect(emptyDraft("2026-09-11", "withdrawal").treatment).toBe("external");
  });

  test("the amount starts NULL, never 0", () => {
    // An empty box is not a zero flow, and a zero flow is refused anyway.
    expect(emptyDraft("2026-09-11").amount).toBeNull();
  });
});
