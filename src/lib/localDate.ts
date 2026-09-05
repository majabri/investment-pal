// The user's calendar date, not the UTC one.
//
// `new Date().toISOString().slice(0, 10)` is the obvious spelling and it is
// wrong for anything a person will read as "the day I did this": west of
// Greenwich it rolls over hours early, so an evening action gets recorded as
// tomorrow. That matters here because the margin rate's `as_of` is a
// verification date the owner will compare against their own memory and against
// a broker statement, and because `rateStatus` ages it in whole days — a date a
// day ahead reads as a negative age, which the app treats as unverifiable.
//
// Deliberately not date-fns: this is three lines, and the point is that the
// arithmetic is visible.

/** `YYYY-MM-DD` in the runtime's local timezone. */
export function localIsoDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Whether an ISO date is in the future by the local calendar.
 *
 * Compared as calendar dates, not instants: "today" is never in the future,
 * whatever the time of day and whichever side of UTC the user is on.
 */
export function isFutureLocalDate(iso: string, now: Date = new Date()): boolean {
  return iso > localIsoDate(now);
}

/**
 * Whether an ISO date names a day that actually exists.
 *
 * `new Date("2026-02-31T00:00:00Z")` does NOT return Invalid Date — it
 * overflows to 3 March. So a "is this a real date" check written as a NaN test
 * silently accepts 31 February and stores a day the user never chose. That
 * matters for the margin rate's `as_of`, which is a claim about when a rate was
 * verified: an overflowed date is provenance the data does not support, and
 * Postgres rejects the same string outright, so the client-side check is the
 * only place the user learns what is wrong.
 *
 * Checked by round-trip rather than by parsing: the parsed date must format
 * back to the same calendar day it came from.
 */
export function isRealCalendarDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === iso;
}
