// Whether a calendar fetch answered, or merely returned nothing (BR-008, §15.4).
//
// The calendar providers are asked one day at a time. Before this module, a day
// whose request failed was skipped with `continue`, and a week in which every
// request failed therefore came back as an empty list — the same empty list a
// genuinely quiet week produces. The server then threw `Error("empty")` for
// BOTH, and fell back to a seed file whose dates had all passed. Three states
// collapsed into one: the readiness gate could not tell a dead feed from a
// quiet week, and neither could the person reading the screen.
//
// The blueprint lists this as a mandatory data-state test: "feed failure
// differs from successful no-event result." The distinction is made here,
// where it can be tested without a network.
//
// Pure. The server function collects the per-day results and asks.

/** One day's request: it answered with rows (possibly none), or it did not answer. */
export type DayFetch<T> = { ok: true; rows: T[] } | { ok: false };

export type CalendarOutcome<T> =
  /** No day answered. The provider is unreachable; nothing can be said about events. */
  | { kind: "unavailable"; failed: number }
  /**
   * At least one day answered. `rows` may be empty — that is a quiet period,
   * not a failure. `failed` is the count of days that did not answer; when it
   * is non-zero the list is a LOWER BOUND on the period's events, and a caller
   * that renders it as complete is making a claim the data does not support.
   */
  | { kind: "rows"; rows: T[]; fetched: number; failed: number };

export function collectCalendar<T>(days: readonly DayFetch<T>[]): CalendarOutcome<T> {
  let fetched = 0;
  let failed = 0;
  const rows: T[] = [];
  for (const d of days) {
    if (d.ok) {
      fetched += 1;
      rows.push(...d.rows);
    } else {
      failed += 1;
    }
  }
  if (fetched === 0) return { kind: "unavailable", failed };
  return { kind: "rows", rows, fetched, failed };
}

/** True when the outcome is a real answer with nothing in it: a quiet period. */
export function isQuietPeriod<T>(outcome: CalendarOutcome<T>): boolean {
  return outcome.kind === "rows" && outcome.rows.length === 0;
}
