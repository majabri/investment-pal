// Stage 5. The recurring question these tests answer: what does a summary
// panel show when it has less history than its label promises? Never 0%.
import { describe, expect, test } from "bun:test";

import { accountTotals } from "../accountTotals";
import {
  allocation,
  balanceSeries,
  dayChange,
  goalProgress,
  performance,
  seriesInRange,
  CHART_RANGES,
  summaryMetrics,
  summaryReadiness,
  EVENT_SOURCES,
  PERFORMANCE_WINDOWS,
  type SnapshotLike,
} from "../portfolioSummary";

const snap = (
  created_at: string,
  net: number,
  gross = net,
  margin_used = gross - net,
): SnapshotLike => ({
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
    const s = balanceSeries([snap("2026-09-01T09:00:00Z", 100), snap("2026-09-01T16:00:00Z", 180)]);
    expect(s).toHaveLength(1);
    expect(s[0].net).toBe(180);
  });

  test("an unparseable timestamp is skipped, not guessed at", () => {
    const s = balanceSeries([snap("not-a-date", 100), snap("2026-09-01T10:00:00Z", 200)]);
    expect(s.map((p) => p.date)).toEqual(["2026-09-01"]);
  });

  test("the owner's recorded day wins over the UTC day of the timestamp", () => {
    // The whole reason `snapshot_date` exists. A 22:30 local snapshot west of
    // Greenwich is stamped the NEXT day in UTC; bucketing by the timestamp
    // would file it under tomorrow and reintroduce the defect Stage 5 removed.
    const s = balanceSeries([
      { ...snap("2026-09-04T03:30:00Z", 100), snapshot_date: "2026-09-03" },
    ]);
    expect(s.map((p) => p.date)).toEqual(["2026-09-03"]);
  });

  test("two snapshots the owner calls one day collapse to one point", () => {
    const s = balanceSeries([
      { ...snap("2026-09-03T14:00:00Z", 100), snapshot_date: "2026-09-03" },
      { ...snap("2026-09-04T03:30:00Z", 180), snapshot_date: "2026-09-03" },
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].net).toBe(180);
  });

  test("a legacy row with no recorded day falls back to the timestamp", () => {
    // Rows written before the column existed. The UTC day is the best fact
    // available about them, and it is better than dropping them.
    const s = balanceSeries([{ ...snap("2026-09-01T10:00:00Z", 100), snapshot_date: null }]);
    expect(s.map((p) => p.date)).toEqual(["2026-09-01"]);
  });

  test("a malformed recorded day falls back rather than becoming the bucket", () => {
    const s = balanceSeries([
      { ...snap("2026-09-01T10:00:00Z", 100), snapshot_date: "not-a-date" },
    ]);
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
    snap("2026-09-03T10:00:00Z", 128_450),
  ]);

  test("a measurable window reports the change and the dates behind it", () => {
    const week = performance(series).find((p) => p.label === "1 week")!;
    expect(week.change).toBeCloseTo(76_450, 2);
    expect(week.from).toBe("2026-09-01");
    expect(week.to).toBe("2026-09-03");
  });

  test("a window longer than the history is flagged, not silently shortened", () => {
    // "1 month: +$78,450" over 29 days of history is a number that means
    // something quite different from what its label says.
    const m = performance(series).find((p) => p.label === "1 month")!;
    expect(m.truncated).toBe(true);
    expect(m.change).toBeCloseTo(78_450, 2);
  });

  test("year to date anchors to 1 January, not to 365 days back", () => {
    // On 3 January these differ by the whole figure. A YTD window computed as
    // a day count silently reports last year's growth as this year's.
    const spanning = balanceSeries([
      snap("2025-11-01T10:00:00Z", 40_000),
      snap("2026-01-02T10:00:00Z", 50_000),
      snap("2026-09-03T10:00:00Z", 128_450),
    ]);
    const ytd = performance(spanning).find((p) => p.label === "Year to date")!;
    expect(ytd.from).toBe("2026-01-02");
    expect(ytd.change).toBeCloseTo(78_450, 2);
    // All time reaches back into the previous year, and is larger.
    const all = performance(spanning).find((p) => p.label === "All time")!;
    expect(all.change).toBeCloseTo(88_450, 2);
  });

  test("year to date is truncated when the history starts mid-year", () => {
    const midYear = balanceSeries([
      snap("2026-08-05T10:00:00Z", 50_000),
      snap("2026-09-03T10:00:00Z", 128_450),
    ]);
    expect(performance(midYear).find((p) => p.label === "Year to date")!.truncated).toBe(true);
  });

  test("all-time is never truncated, whatever the history", () => {
    expect(performance(series).find((p) => p.label === "All time")!.truncated).toBe(false);
  });

  test("with a single point, every window is unknown rather than flat", () => {
    const one = balanceSeries([snap("2026-09-03T10:00:00Z", 128_450)]);
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
      snap("2026-09-01T10:00:00Z", 135_000),
      snap("2026-09-03T10:00:00Z", 128_450),
    ]);
    const all = performance(down).find((p) => p.label === "All time")!;
    expect(all.change).toBeCloseTo(-6_550, 2);
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

  test('a blank sector string counts as unclassified, not as a sector named " "', () => {
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
    const slices = allocation(
      [{ sector: "Technology", quantity: 10, current_price: 100 }],
      () => 200,
    );
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
    const totals = accountTotals([{ quantity: 100, cost_basis: 500, current_price: 1_459.5 }], {
      cash: 2_500,
      margin_used: 20_000,
    });
    const metrics = summaryMetrics(totals);
    const value = (label: string) => metrics.find((m) => m.label === label)!.value;
    expect(value("Total account value")!).toBeCloseTo(128_450, 2);
    expect(value("Investments")!).toBeCloseTo(145_950, 2);
    expect(value("Margin debit")!).toBeCloseTo(20_000, 2);
    expect(value("Equity")!).toBeCloseTo(0.8653, 3);
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

describe("chart ranges", () => {
  const series = balanceSeries([
    snap("2025-09-03T10:00:00Z", 30_000),
    snap("2026-03-03T10:00:00Z", 45_000),
    snap("2026-08-20T10:00:00Z", 52_000),
    snap("2026-09-03T10:00:00Z", 128_450),
  ]);

  test("a range keeps only the points inside it", () => {
    const oneMonth = seriesInRange(series, { label: "1M", months: 1 });
    expect(oneMonth.map((p) => p.date)).toEqual(["2026-08-20", "2026-09-03"]);
  });

  test("All keeps everything", () => {
    expect(seriesInRange(series, { label: "All", months: null })).toHaveLength(4);
  });

  test("a range with no points inside still shows the latest, not nothing", () => {
    // Clipping to empty would render "no history", which is a different fact
    // from "no history in the last month".
    const sparse = balanceSeries([snap("2025-01-01T10:00:00Z", 10_000)]);
    expect(seriesInRange(sparse, { label: "1M", months: 1 })).toHaveLength(1);
  });

  test("an empty series stays empty", () => {
    expect(seriesInRange([], { label: "1M", months: 1 })).toEqual([]);
  });

  test("every offered range is selectable and named", () => {
    expect(CHART_RANGES.map((r) => r.label)).toEqual(["1M", "3M", "6M", "1Y", "All"]);
  });
});

describe("goal progress", () => {
  const objective = { starting_value: 50_000, target_value: 150_000 };

  test("halfway is a half", () => {
    expect(goalProgress(100_000, objective)).toBeCloseTo(0.5, 10);
  });

  test("no objective is null, never zero", () => {
    // A progress bar at 0% claims the account has made none. "There is no
    // target to measure against" is a different statement.
    expect(goalProgress(100_000, null)).toBeNull();
  });

  test("no current value is null", () => {
    expect(goalProgress(null, objective)).toBeNull();
  });

  test("a target at or below the start cannot define progress", () => {
    expect(goalProgress(60_000, { starting_value: 150_000, target_value: 150_000 })).toBeNull();
    expect(goalProgress(60_000, { starting_value: 150_000, target_value: 100_000 })).toBeNull();
  });

  test("clamped to [0,1] for the bar", () => {
    expect(goalProgress(200_000, objective)).toBe(1);
    expect(goalProgress(10_000, objective)).toBe(0);
  });
});

describe("day change", () => {
  const positions = [
    { symbol: "AAA", quantity: 10 },
    { symbol: "BBB", quantity: 5 },
    { symbol: "CCC", quantity: 2 },
  ];

  test("sums quantity times the move, and says what it covered", () => {
    const d = dayChange(positions, {
      AAA: { price: 110, prevClose: 100 },
      BBB: { price: 90, prevClose: 100 },
    })!;
    expect(d.amount).toBe(50); // +100 on AAA, −50 on BBB
    expect(d.covered).toBe(2);
    expect(d.total).toBe(3);
  });

  test("no quotes at all is null, not zero", () => {
    // Zero says the account did not move. Null says the data has not arrived.
    expect(dayChange(positions, undefined)).toBeNull();
    expect(dayChange(positions, {})).toBeNull();
  });

  test("a quote with no previous close does not count as covered", () => {
    // Treating prevClose 0 as a valid baseline would report the full position
    // value as today's gain.
    expect(dayChange(positions, { AAA: { price: 110, prevClose: 0 } })).toBeNull();
  });
});
