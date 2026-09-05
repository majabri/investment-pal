// Coverage: did we look, and did we get an answer? (Phase 5, rule 30.)
//
// "Any financial-data failure capable of changing a decision fails visibly.
// 'Account equity: Unavailable', never $0. 'Open-order status unavailable',
// never 'No open orders'. 'Economic-event coverage unavailable', never
// 'No events.'"
//
// The last of those three was live on four screens. Each one wrote
//
//     const { data: events = [], isLoading } = useQuery(...)
//
// and then rendered on `!isLoading && events.length === 0`. React Query
// resolves `isLoading` to false when a query FAILS, and the `= []` default
// fills in for the missing data, so a fetch that returned an error rendered:
//
//   * /geopolitics   — "Nothing market-relevant right now."
//   * /earnings      — "No earnings for these names in the next 14 days."
//   * /economic-calendar and /news — an empty page with no message at all,
//     which reads the same way and gives the user nothing to act on.
//
// All four are decision-changing. "No earnings this week" is a reason to hold
// through the week; "we could not reach the earnings source" is a reason to
// check before you do. And the committee prompt rendered the same absence to a
// model as "- (none)".
//
// The distinction is small and the wording is the whole fix, so both live here
// rather than at four call sites that would drift.

/**
 * Three states, and the third is the one the app could not previously express.
 *
 * `UNAVAILABLE` is not "empty": we asked and did not get an answer. It is the
 * same distinction `Freshness` draws between UNKNOWN and a figure, and the
 * same one `ReadinessCheck` draws between `fail` and `unknown`.
 */
export type Coverage = "LOADING" | "AVAILABLE" | "UNAVAILABLE";

/** The parts of a React Query result this depends on — no import needed. */
export type QueryLike = {
  isLoading: boolean;
  isError?: boolean;
  data?: unknown;
};

/**
 * Read a query's coverage.
 *
 * `isError` alone is not enough. A query can settle with `data` undefined —
 * disabled, cancelled, or resolved to nothing by a server function that
 * swallowed its own error — and a caller's `= []` default then makes that
 * indistinguishable from an empty result. Undefined data on a settled query is
 * UNAVAILABLE, which is why this takes the query rather than the defaulted
 * array.
 */
export function coverageOf(q: QueryLike): Coverage {
  if (q.isLoading) return "LOADING";
  if (q.isError) return "UNAVAILABLE";
  return q.data === undefined || q.data === null ? "UNAVAILABLE" : "AVAILABLE";
}

/**
 * What to show above a list, or `null` when the list itself is the answer.
 *
 * `subject` is a noun phrase in lower case — "economic events", "earnings for
 * these names", "market-relevant developments" — because it is used mid
 * sentence in all three states.
 *
 * `emptyMessage` is the caller's, because only the caller knows what an
 * honestly empty result means on that screen. There is no default: a generic
 * "nothing found" is exactly the sentence this module exists to stop being
 * printed over a failure.
 */
export function coverageNotice(
  subject: string,
  coverage: Coverage,
  count: number,
  emptyMessage: string,
): string | null {
  switch (coverage) {
    case "LOADING":
      return `Loading ${subject}…`;
    case "UNAVAILABLE":
      // Says what happened, says what it is NOT, and says what to do. The
      // middle clause is the one that matters: without it a user reads
      // "unavailable" as "none" anyway.
      return `${capitalise(subject)} coverage unavailable — the source could not be reached. This is not the same as there being none; try again shortly.`;
    case "AVAILABLE":
      return count === 0 ? emptyMessage : null;
  }
}

/**
 * The same distinction, for a prompt.
 *
 * A model reads "- (none)" as a fact and reasons from it: no catalysts this
 * week, therefore nothing to wait for. `NOT KNOWN` is read as missing, which
 * is what it is. The wording is deliberately not the UI's — a model is not
 * looking at a screen and "try again shortly" means nothing to it.
 */
export function coveragePromptLines(
  subject: string,
  coverage: Coverage,
  lines: readonly string[],
): string {
  if (coverage !== "AVAILABLE") {
    return `- ${capitalise(subject)} coverage is NOT KNOWN — the source could not be read. Do not conclude there are none, and do not reason as if this were an empty list.`;
  }
  return lines.length === 0
    ? `- (none — the source was read and returned nothing)`
    : lines.map((l) => `- ${l}`).join("\n");
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
