// Portfolio Summary: the arithmetic behind the summary surface (Stage 5).
//
// Everything here is pure. The summary screen is six panels of numbers over one
// account, and the reason they live in a module rather than in the route is
// that "what does 1-month performance mean when there are four days of
// history?" is a question with a right answer, and the right answer is not 0%.
//
// The rule this module enforces, inherited from Stage 1: a figure with no basis
// is `null`, not zero. A performance panel showing "0.00%" for a window it has
// no data for is a claim the portfolio did not move.

import type { AccountTotals } from "./accountTotals";

/** A recorded snapshot, in the shape the summary needs. */
export type SnapshotLike = {
  /** Gross: positions + cash, before the margin debit. */
  gross: number;
  /** Net: Fidelity's total account value. */
  net: number;
  margin_used: number;
  /**
   * The calendar day the snapshot represents, in the OWNER's timezone.
   *
   * Authoritative over `created_at` for bucketing. Deriving the day from the
   * timestamp means deriving it in UTC, which rolls over hours early west of
   * Greenwich — the exact defect Stage 5 added this column to remove. `null`
   * only on rows written before the column existed.
   */
  snapshot_date?: string | null;
  /** ISO timestamp. The fallback day, and the tie-break within a day. */
  created_at: string;
};

/** One point on the balance-over-time chart. */
export type BalancePoint = {
  /** `YYYY-MM-DD`, the calendar day of the snapshot. */
  date: string;
  gross: number;
  net: number;
  marginUsed: number;
};

const num = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/**
 * Snapshots as a chart series: one point per calendar day, oldest first.
 *
 * When a day carries several snapshots the LAST one wins — it is the most
 * recent observation of that day, and averaging them would invent a value that
 * was never the account's balance at any moment.
 */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The owner's day where recorded, the UTC day of the timestamp otherwise. */
function dayOf(s: SnapshotLike): string | null {
  const stored = s.snapshot_date?.slice(0, 10);
  if (stored && ISO_DAY.test(stored)) return stored;
  const derived = s.created_at.slice(0, 10);
  return ISO_DAY.test(derived) ? derived : null;
}

export function balanceSeries(snapshots: readonly SnapshotLike[]): BalancePoint[] {
  const byDay = new Map<string, BalancePoint>();
  const sorted = [...snapshots].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const s of sorted) {
    const date = dayOf(s);
    if (date === null) continue; // no usable day: skip, never guess
    byDay.set(date, {
      date,
      gross: num(s.gross),
      net: num(s.net),
      marginUsed: num(s.margin_used),
    });
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * A comparison period.
 *
 * `days` counts back from the latest point. `ytd` anchors to 1 January of the
 * latest point's year instead — year-to-date is not "365 days", and on
 * 3 January the difference between the two is the entire figure.
 */
export type PerformanceWindow =
  | { label: string; kind: "days"; days: number }
  | { label: string; kind: "ytd" }
  | { label: string; kind: "all" };

/** The windows the summary reports. Deliberately short — each needs real data. */
export const PERFORMANCE_WINDOWS: PerformanceWindow[] = [
  { label: "Today", kind: "days", days: 1 },
  { label: "1 week", kind: "days", days: 7 },
  { label: "1 month", kind: "days", days: 30 },
  { label: "Year to date", kind: "ytd" },
  { label: "All time", kind: "all" },
];

export type PerformanceEntry = {
  label: string;
  /** Change in net account value, or null when the window has no earlier point. */
  change: number | null;
  /** Fractional change, or null when there is nothing to divide by. */
  changePct: number | null;
  /** The day the comparison starts from, so the figure can be checked. */
  from: string | null;
  to: string | null;
  /**
   * True when the window is longer than the recorded history, so the figure —
   * if any — covers less time than its label claims.
   *
   * Reported rather than hidden: "1 month: +$2,000" over four days of history
   * is a number that means something quite different from what it says.
   */
  truncated: boolean;
};

/**
 * Performance over each window, from the recorded series.
 *
 * Uses NET (total account value), not gross: the debit is part of what the
 * account is worth, and measuring performance on gross would show a margin
 * drawdown as growth.
 */
export function performance(
  series: readonly BalancePoint[],
  windows: readonly PerformanceWindow[] = PERFORMANCE_WINDOWS,
): PerformanceEntry[] {
  const latest = series.at(-1);
  const earliest = series.at(0);
  if (!latest || !earliest) {
    // No history at all. Every window is unknown, and says so.
    return windows.map((w) => ({
      label: w.label,
      change: null,
      changePct: null,
      from: null,
      to: null,
      truncated: false,
    }));
  }

  const latestMs = Date.parse(`${latest.date}T00:00:00Z`);
  const spanDays = Math.round((latestMs - Date.parse(`${earliest.date}T00:00:00Z`)) / 86_400_000);

  return windows.map((w) => {
    // Where the window starts. All three kinds are compared as calendar dates,
    // so the arithmetic never turns on a timezone.
    const cutoff =
      w.kind === "all"
        ? earliest.date
        : w.kind === "ytd"
          ? `${latest.date.slice(0, 4)}-01-01`
          : new Date(latestMs - w.days * 86_400_000).toISOString().slice(0, 10);
    const truncated = w.kind !== "all" && cutoff < earliest.date;
    // The first point at or after the window start. Falls back to the oldest
    // point we have, with `truncated` flagging that the window reaches further
    // back than the history — never silently reporting a shorter period under
    // a longer label.
    const start = series.find((p) => p.date >= cutoff) ?? earliest;

    // A single day of history compared with itself is not 0% performance, it is
    // no performance figure at all.
    if (start.date === latest.date) {
      return {
        label: w.label,
        change: null,
        changePct: null,
        from: null,
        to: latest.date,
        truncated,
      };
    }

    const change = latest.net - start.net;
    return {
      label: w.label,
      change,
      changePct: start.net > 0 ? change / start.net : null,
      from: start.date,
      to: latest.date,
      truncated,
    };
  });
}

export type AllocationSlice = {
  name: string;
  value: number;
  /** Share of the total, as a fraction. */
  share: number;
};

/** A position, in the shape allocation needs. */
export type AllocatablePosition = {
  sector: string | null;
  quantity: number;
  current_price: number;
};

/**
 * Allocation slices, largest first, with an explicit "Unclassified" bucket.
 *
 * Positions with no sector are their OWN slice rather than being dropped or
 * folded into the largest one. A doughnut whose slices sum to less than the
 * portfolio is a picture that quietly disagrees with the total beside it.
 */
export function allocation<T extends AllocatablePosition>(
  positions: readonly T[],
  priceOf: (p: T) => number = (p) => num(p.current_price),
): AllocationSlice[] {
  const byName = new Map<string, number>();
  let total = 0;
  for (const p of positions) {
    const value = num(p.quantity) * num(priceOf(p));
    // A zero or negative-valued position adds nothing to a share-of-total
    // picture and would make the shares fail to sum to 1.
    if (value <= 0) continue;
    const name = p.sector?.trim() ? p.sector.trim() : "Unclassified";
    byName.set(name, (byName.get(name) ?? 0) + value);
    total += value;
  }
  if (total <= 0) return [];
  return [...byName.entries()]
    .map(([name, value]) => ({ name, value, share: value / total }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Whether the summary's headline figures rest on anything.
 *
 * The summary shows a metric row derived from `accountTotals`. Those are live
 * and always available; the chart and performance panels are not, because they
 * need recorded history. Saying which is which stops an empty chart reading as
 * a flat portfolio.
 */
export type SummaryReadiness = {
  /** Points available for the chart. */
  points: number;
  /** A chart needs two points to be a line rather than a dot. */
  chartReady: boolean;
  /** Any window at all has a comparison to make. */
  performanceReady: boolean;
};

export function summaryReadiness(series: readonly BalancePoint[]): SummaryReadiness {
  return {
    points: series.length,
    chartReady: series.length >= 2,
    performanceReady: series.length >= 2,
  };
}

/**
 * Which portfolio events the app can actually show.
 *
 * Earnings dates come from Nasdaq's calendar through the provider layer.
 * DIVIDENDS DO NOT: there is no dividend source behind the free-data
 * constraint (OD-002), and the app has never had one. The brief asks for
 * dividends in this panel, so this type exists to say "not available" on the
 * screen rather than leaving a heading with nothing under it — and certainly
 * rather than generating plausible dividend dates, which is exactly the
 * unsourced assertion AIOS §27 prohibits.
 */
export type EventSourceStatus = {
  kind: "earnings" | "dividends";
  available: boolean;
  /** Shown to the user when unavailable. Explains, does not apologise. */
  note: string;
};

export const EVENT_SOURCES: EventSourceStatus[] = [
  {
    kind: "earnings",
    available: true,
    note: "Earnings dates from Nasdaq's calendar, for your held symbols.",
  },
  {
    kind: "dividends",
    available: false,
    // Stated plainly, with the reason. A vague "coming soon" invites the
    // assumption that a blank panel means no dividends are due.
    note: "No dividend data source is configured. The app uses free sources only (OD-002), and none of them supplies dividend schedules — so this is unknown, not empty. Do not read a blank panel as 'no dividends due'.",
  },
];

/** Selectable spans for the balance chart. `null` = the whole series. */
export type ChartRange = { label: string; months: number | null };

export const CHART_RANGES: ChartRange[] = [
  { label: "1M", months: 1 },
  { label: "3M", months: 3 },
  { label: "6M", months: 6 },
  { label: "1Y", months: 12 },
  { label: "All", months: null },
];

/**
 * The tail of the series covered by a range.
 *
 * Never empty when the series is not: a range shorter than the gap between the
 * last two points would otherwise clip the chart to nothing and read as "no
 * history", which is a different fact from "no history in the last month".
 */
export function seriesInRange(
  series: readonly BalancePoint[],
  range: ChartRange,
): BalancePoint[] {
  if (range.months === null || series.length === 0) return [...series];
  const latest = series[series.length - 1];
  const cutoffDate = new Date(`${latest.date}T00:00:00Z`);
  cutoffDate.setUTCMonth(cutoffDate.getUTCMonth() - range.months);
  const cutoff = cutoffDate.toISOString().slice(0, 10);
  const within = series.filter((p) => p.date >= cutoff);
  return within.length > 0 ? within : [latest];
}

/**
 * Progress from the objective's starting value towards its target.
 *
 * `null` — not a number — whenever the objective cannot define progress:
 * no objective, or a target at or below the start. A progress bar at 0% claims
 * the account has made none, which is a different statement from "there is no
 * target to measure against".
 */
export function goalProgress(
  currentValue: number | null,
  objective: { starting_value: number; target_value: number } | null | undefined,
): number | null {
  if (currentValue === null || !objective) return null;
  const span = num(objective.target_value) - num(objective.starting_value);
  if (span <= 0) return null;
  const raw = (currentValue - num(objective.starting_value)) / span;
  // Clamped for display. Past the target is 100% of a bar, not 140% of one —
  // but the underlying value is still shown as a figure beside it.
  return Math.max(0, Math.min(1, raw));
}

/** Headline figures for the metric row, straight off `accountTotals`. */
export type SummaryMetric = { label: string; value: number | null; kind: "money" | "percent" };

/**
 * The metric row, in one place so the summary and any future surface agree.
 *
 * `null` where the totals have no basis — the percentages, when there is no
 * denominator. The screen renders those as an em dash.
 */
export function summaryMetrics(totals: AccountTotals | null): SummaryMetric[] {
  return [
    { label: "Total account value", value: totals?.totalAccountValue ?? null, kind: "money" },
    { label: "Investments", value: totals?.positionsValue ?? null, kind: "money" },
    { label: "Cash", value: totals?.cash ?? null, kind: "money" },
    { label: "Margin debit", value: totals?.marginDebit ?? null, kind: "money" },
    { label: "Unrealized P/L", value: totals?.unrealizedPL ?? null, kind: "money" },
    { label: "Equity", value: totals?.equityPct ?? null, kind: "percent" },
  ];
}

/**
 * Today's change from live quotes, over the same positions as the totals.
 *
 * `null` when no quote carries a previous close — a day change of 0 would say
 * the account did not move, which is not the same as "the market data has not
 * arrived". `covered` says how many positions the figure actually accounts for,
 * because a day change over 3 of 11 holdings is not the account's day change.
 */
export type DayChange = { amount: number; covered: number; total: number } | null;

export function dayChange(
  positions: readonly { symbol: string; quantity: number }[],
  quotes: Record<string, { price: number; prevClose: number }> | undefined,
): DayChange {
  if (!quotes) return null;
  let amount = 0;
  let covered = 0;
  for (const p of positions) {
    const q = quotes[p.symbol];
    if (q && Number.isFinite(q.prevClose) && q.prevClose > 0) {
      amount += num(p.quantity) * (num(q.price) - num(q.prevClose));
      covered++;
    }
  }
  return covered > 0 ? { amount, covered, total: positions.length } : null;
}
