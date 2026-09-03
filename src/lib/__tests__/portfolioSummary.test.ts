// Stage 5. The recurring question these tests answer: what does a summary
// panel show when it has less history than its label promises? Never 0%.
import { describe, expect, test } from "bun:test";

import { accountTotals } from "../accountTotals";
import {
  allocation,
  balanceSeries,
  performance,
  summaryMetrics,
  summaryReadiness,
  EVENT_SOURCES,
  PERFORMANCE_WINDOWS,
  type SnapshotLike,
} from "../portfolioSummary";

const snap = (created_at: string, net: number, gross = net, margin_used = gross - net): SnapshotLike => ({
  created_at,
  net,
  gross,
  margin_used,
});

describe("balanceSeries", () => {
  test("one point per calendar day, oldest first", () => {
    const s = balanceSeries([
      snap("2026-09-03T20:00:00Z", 300),
      snap("2026-09-01T10:00:00Z", 100),
      snap("2026-09-02T10:00:00Z", 200),
    ]);
    expect(s.map((p) => p.date)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect(s.map((p) => p.net)).toEqual([100, 200, 300]);
  });

  test("the last snapshot of a day wins, rather than an average of them", () => {
    // An average is a value the account never actually held at any moment.
    const s = balanceSeries([
      snap("2026-09-01T09:00:00Z", 100),
      snap("2026-09-01T16:00:00Z", 180),
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].net).toBe(180);
  });

  test("an unparseable timestamp is skipped, not guessed at", () => {
    const s = balanceSeries([snap("not-a-date", 100), snap("2026-09-01T10:00:00Z", 200)]);
    expect(s.map((p) => p.date)).toEqual(["2026-09-01"]);
  });

  test("no snapshots is an empty series, not a zero point", () => {
    // A single point at zero would draw a portfolio worth nothing.
    expect(balanceSeries([])).toEqual([]);
  });
});

describe("performance never reports 0% for a window it cannot measure", () => {
  const series = balanceSeries([
    snap("2026-08-05T10:00:00Z", 50_000),
    snap("2026-09-01T10:00:00Z", 52_000),
    snap("2026-09-03T10:00:00Z", 53_938.35),
  ]);

  test("a measurable window reports the change and the dates behind it", () => {
    const week = performance(series).find((p) => p.label === "1 week")!;
    expect(week.change).toBeCloseTo(1_938.35, 2);
    expect(week.from).toBe("2026-09-01");
    expect(week.to).toBe("2026-09-03");
  });

  test("a window longer than the history is flagged, not silently shortened", () => {
    // "3 months: +$3,938" over 29 days of history is a number that means
    // something quite different from what its label says.
    const q = performance(series).find((p) => p.label === "3 months")!;
    expect(q.truncated).toBe(true);
    expect(q.change).toBeCloseTo(3_938.35, 2);
  });

  test("all-time is never truncated, whatever the history", () => {
    expect(performance(series).find((p) => p.label === "All time")!.truncated).toBe(false);
  });

  test("with a single point, every window is unknown rather than flat", () => {
    const one = balanceSeries([snap("2026-09-03T10:00:00Z", 53_938.35)]);
    for (const entry of performance(one)) {
      expect(entry.change).toBeNull();
      expect(entry.changePct).toBeNull();
    }
  });

  test("with no history at all, every window is unknown", () => {
    const none = performance([]);
    expect(none).toHaveLength(PERFORMANCE_WINDOWS.length);
    expect(none.every((e) => e.change === null && e.from === null)).toBe(true);
  });

  test("percent is null when the starting value was zero", () => {
    // Dividing by zero would give Infinity, which renders as "∞%".
    const fromZero = balanceSeries([
      snap("2026-09-01T10:00:00Z", 0),
      snap("2026-09-03T10:00:00Z", 500),
    ]);
    const all = performance(fromZero).find((p) => p.label === "All time")!;
    expect(all.change).toBe(500);
    expect(all.changePct).toBeNull();
  });

  test("a loss is reported as a loss", () => {
    const down = balanceSeries([
      snap("2026-09-01T10:00:00Z", 60_000),
      snap("2026-09-03T10:00:00Z", 53_938.35),
    ]);
    const all = performance(down).find((p) => p.label === "All time")!;
    expect(all.change).toBeCloseTo(-6_061.65, 2);
    expect(all.changePct!).toBeLessThan(0);
  });

  test("performance is measured on net, so a margin draw is not growth", () => {
    // Gross rises when you borrow and buy; net does not. Measuring on gross
    // would show taking on leverage as a gain.
    const borrowed = balanceSeries([
      snap("2026-09-01T10:00:00Z", 50_000, 50_000, 0),
      snap("2026-09-03T10:00:00Z", 50_000, 70_000, 20_000),
    ]);
    const all = performance(borrowed).find((p) => p.label === "All time")!;
    expect(all.change).toBe(0);
  });
});

describe("allocation", () => {
  const positions = [
    { sector: "Technology", quantity: 10, current_price: 100 },
    { sector: "Technology", quantity: 5, current_price: 100 },
    { sector: "Healthcare", quantity: 10, current_price: 50 },
    { sector: null, quantity: 10, current_price: 10 },
  ];

  test("slices sum to the whole and to a share of 1", () => {
    // A doughnut whose slices sum to less than the total beside it is a picture
    // that quietly disagrees with the number.
    const slices = allocation(positions);
    expect(slices.reduce((s, x) => s + x.value, 0)).toBe(2_100);
    expect(slices.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 10);
  });

  test("positions with no sector get their own slice, never dropped", () => {
    const slices = allocation(positions);
    const unclassified = slices.find((s) => s.name === "Unclassified")!;
    expect(unclassified.value).toBe(100);
  });

  test("a blank sector string counts as unclassified, not as a sector named \" \"", () => {
    const slices = allocation([{ sector: "   ", quantity: 1, current_price: 10 }]);
    expect(slices[0].name).toBe("Unclassified");
  });

  test("largest slice first", () => {
    expect(allocation(positions).map((s) => s.name)).toEqual([
      "Technology",
      "Healthcare",
      "Unclassified",
    ]);
  });

  test("a live price overrides the stored one", () => {
    const slices = allocation([{ sector: "Technology", quantity: 10, current_price: 100 }], () => 200);
    expect(slices[0].value).toBe(2_000);
  });

  test("no positions is no doughnut, not a doughnut of zero", () => {
    expect(allocation([])).toEqual([]);
    expect(allocation([{ sector: "Technology", quantity: 0, current_price: 100 }])).toEqual([]);
  });
});

describe("readiness", () => {
  test("one point is not a chart", () => {
    const one = balanceSeries([snap("2026-09-03T10:00:00Z", 100)]);
    expect(summaryReadiness(one).chartReady).toBe(false);
    expect(summaryReadiness(one).points).toBe(1);
  });

  test("two points are", () => {
    const two = balanceSeries([
      snap("2026-09-02T10:00:00Z", 100),
      snap("2026-09-03T10:00:00Z", 110),
    ]);
    expect(summaryReadiness(two).chartReady).toBe(true);
    expect(summaryReadiness(two).performanceReady).toBe(true);
  });
});

describe("event sources say what they cannot show", () => {
  test("dividends are declared unavailable, with the reason", () => {
    // The brief asks for dividends in this panel. There is no free dividend
    // source (OD-002), so the panel says so. Generating plausible dividend
    // dates would be exactly the unsourced assertion AIOS §27 prohibits.
    const dividends = EVENT_SOURCES.find((s) => s.kind === "dividends")!;
    expect(dividends.available).toBe(false);
    expect(dividends.note).toContain("free sources only");
  });

  test("the note warns against reading blank as none due", () => {
    // The failure mode is not the missing panel, it is the confident reading
    // of an empty one.
    const dividends = EVENT_SOURCES.find((s) => s.kind === "dividends")!;
    expect(dividends.note.toLowerCase()).toContain("no dividends due");
  });

  test("earnings are available and named", () => {
    const earnings = EVENT_SOURCES.find((s) => s.kind === "earnings")!;
    expect(earnings.available).toBe(true);
    expect(earnings.note).toContain("Nasdaq");
  });
});

describe("the metric row", () => {
  test("reads straight off accountTotals and reconciles to the statement", () => {
    const totals = accountTotals(
      [{ quantity: 100, cost_basis: 500, current_price: 606.023 }],
      { cash: 0.38, margin_used: 6_664.33 },
    );
    const metrics = summaryMetrics(totals);
    const value = (label: string) => metrics.find((m) => m.label === label)!.value;
    expect(value("Total account value")!).toBeCloseTo(53_938.35, 2);
    expect(value("Margin loan")!).toBeCloseTo(6_664.33, 2);
    expect(value("Equity")!).toBeCloseTo(0.89, 3);
  });

  test("no totals means every metric is unknown, not zero", () => {
    // The metric row over an unresolved account. Six zeroes would read as an
    // empty account, which is a different claim from "no account selected".
    expect(summaryMetrics(null).every((m) => m.value === null)).toBe(true);
  });

  test("percent metrics are marked as percentages", () => {
    // The row formats by `kind`; mislabelling equity as money renders 0.89 as
    // $0.89 rather than 89%.
    expect(summaryMetrics(null).find((m) => m.label === "Equity")!.kind).toBe("percent");
  });
});
