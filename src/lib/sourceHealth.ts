// Is each data source answering? (OBS-001.)
//
// The audit's finding was "no `data_source_health`, no health surface". Those
// are two things, and only the second produces a wrong reading today:
//
//   * A HEALTH SURFACE says whether each source answered on this page load. It
//     needs no table — the app already draws the LOADING / AVAILABLE /
//     UNAVAILABLE distinction per query in `coverage.ts`, and nothing gathers
//     those into one place a person can look at.
//   * A HEALTH HISTORY — uptime over days, which source fails most — genuinely
//     needs persistence, and is deliberately not built here. Adding a fourth
//     unapplied migration to answer a question nobody has asked yet is worse
//     than answering the question that is being asked now.
//
// WHY THIS MATTERS AT ALL, given `coverage.ts` exists
//
// Coverage is per-query and per-screen. A user on /portfolio cannot see that
// the news source has been failing all morning, and the committee prompt says
// "News coverage is NOT KNOWN" without saying whether that is one source or
// all of them. This is the one place that answers "what is working right now".
//
// Free sources only (OD-002), so every entry here is a public endpoint that can
// and does fail. That is normal, and the surface exists to make it legible
// rather than to alarm.
import type { Coverage } from "./coverage";

/** A source the app reads. `kind` groups the ones a single provider serves. */
export type SourceId =
  | "quotes"
  | "prices"
  | "market-snapshot"
  | "earnings-calendar"
  | "econ-calendar"
  | "news"
  | "geopolitics";

export type SourceDescriptor = {
  id: SourceId;
  label: string;
  /** The provider, named, so a failure points somewhere. */
  provider: string;
  /** What breaks when this source is unavailable. Not decoration — it is the
   *  difference between "a panel is empty" and "do not trade on this". */
  impact: string;
};

/**
 * Every source the app reads, declared.
 *
 * A closed list rather than something derived from query keys: a source that
 * stops being read should disappear from here deliberately, and a source added
 * without an entry is a source nobody can see the health of.
 */
export const SOURCES: readonly SourceDescriptor[] = [
  {
    id: "quotes",
    label: "Live quotes",
    provider: "Yahoo (free endpoint)",
    impact: "Position values and day change fall back to stored prices.",
  },
  {
    id: "prices",
    label: "Daily closes",
    provider: "Stooq / Yahoo",
    impact: "Price history and swing scores stop updating.",
  },
  {
    id: "market-snapshot",
    label: "Market snapshot",
    provider: "Yahoo (free endpoint)",
    impact: "Index levels are not shown.",
  },
  {
    id: "earnings-calendar",
    label: "Earnings calendar",
    provider: "Nasdaq",
    impact: "Earnings dates are unknown — not 'none this week'.",
  },
  {
    id: "econ-calendar",
    label: "Economic calendar",
    provider: "Free econ feed",
    impact: "Event timing is unknown, which tactical recommendations consume.",
  },
  {
    id: "news",
    label: "News",
    provider: "Free headline feed",
    impact: "The committee is told coverage is NOT KNOWN rather than 'no news'.",
  },
  {
    id: "geopolitics",
    label: "Geopolitics",
    provider: "Free headline feed",
    impact: "The geopolitics screen cannot say whether it is quiet or unread.",
  },
];

/** One source's state right now. */
export type SourceHealth = {
  descriptor: SourceDescriptor;
  coverage: Coverage;
  /** When it last answered, if it has. NULL = not this session. */
  lastOkAt: string | null;
};

/**
 * The whole picture in one word.
 *
 * `degraded` rather than `down` when only some sources fail, because the free
 * feeds fail independently and routinely — one dead headline source is not an
 * outage, and calling it one trains the eye to ignore the banner.
 *
 * `loading` only while NOTHING has answered yet: a page where six sources are
 * live and one is still in flight is not "loading".
 */
export type OverallHealth = "loading" | "ok" | "degraded" | "down";

export function overallHealth(entries: readonly SourceHealth[]): OverallHealth {
  if (entries.length === 0) return "loading";
  const available = entries.filter((e) => e.coverage === "AVAILABLE").length;
  const unavailable = entries.filter((e) => e.coverage === "UNAVAILABLE").length;
  if (available === 0 && unavailable === 0) return "loading";
  if (unavailable === 0) return "ok";
  // Everything that has finished has failed.
  if (available === 0) return "down";
  return "degraded";
}

/** How many sources are in each state, for a one-line summary. */
export function healthCounts(entries: readonly SourceHealth[]): {
  ok: number;
  failing: number;
  loading: number;
} {
  return {
    ok: entries.filter((e) => e.coverage === "AVAILABLE").length,
    failing: entries.filter((e) => e.coverage === "UNAVAILABLE").length,
    loading: entries.filter((e) => e.coverage === "LOADING").length,
  };
}

/** The sentence the banner shows. Never "all good" when something is failing. */
export function healthSummary(entries: readonly SourceHealth[]): string {
  const { ok, failing, loading } = healthCounts(entries);
  switch (overallHealth(entries)) {
    case "loading":
      return "Checking data sources…";
    case "ok":
      return `All ${ok} data sources answered.`;
    case "down":
      return `No data source answered. ${failing} failing.`;
    case "degraded":
      return `${failing} of ${ok + failing + loading} data sources did not answer.`;
  }
}
