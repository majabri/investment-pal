// The UTC date is not the user's date. Everything here is about that one gap.
import { describe, expect, test } from "bun:test";

import { isFutureLocalDate, isRealCalendarDate, localIsoDate } from "../localDate";

describe("localIsoDate", () => {
  test("is the local calendar date, not the UTC one", () => {
    // Constructed from local components, so this holds in whatever timezone
    // the test runs in — including CI, which runs in UTC.
    const d = new Date(2026, 8, 3, 22, 30); // 3 September 2026, 22:30 local
    expect(localIsoDate(d)).toBe("2026-09-03");
  });

  test("late evening is still today", () => {
    // The bug this replaces: `toISOString().slice(0,10)` on a 22:30 local time
    // west of Greenwich already reads as tomorrow, so an evening import would
    // record itself as verified on a day that has not happened.
    const d = new Date(2026, 8, 3, 23, 59, 59);
    expect(localIsoDate(d)).toBe("2026-09-03");
  });

  test("just after midnight is the new day", () => {
    expect(localIsoDate(new Date(2026, 8, 4, 0, 0, 1))).toBe("2026-09-04");
  });

  test("months and days are zero-padded", () => {
    // "2026-1-5" sorts and parses differently from "2026-01-05", and the
    // comparison below is a string comparison.
    expect(localIsoDate(new Date(2026, 0, 5, 12, 0))).toBe("2026-01-05");
  });
});

describe("isFutureLocalDate", () => {
  const now = new Date(2026, 8, 3, 22, 30);

  test("today is never in the future, whatever the time", () => {
    // This is the case the UTC comparison got wrong: for a user east of
    // Greenwich just after local midnight, midnight-UTC of the same date has
    // not arrived, so today's date read as future and was rejected.
    expect(isFutureLocalDate("2026-09-03", now)).toBe(false);
    expect(isFutureLocalDate("2026-09-03", new Date(2026, 8, 3, 0, 0, 1))).toBe(false);
  });

  test("tomorrow is in the future and yesterday is not", () => {
    expect(isFutureLocalDate("2026-09-04", now)).toBe(true);
    expect(isFutureLocalDate("2026-09-02", now)).toBe(false);
  });

  test("comparison is by calendar date across a year boundary", () => {
    const nye = new Date(2026, 11, 31, 23, 0);
    expect(isFutureLocalDate("2027-01-01", nye)).toBe(true);
    expect(isFutureLocalDate("2026-12-31", nye)).toBe(false);
  });
});

describe("isRealCalendarDate", () => {
  test("accepts days that exist", () => {
    for (const d of ["2026-09-03", "2024-02-29", "2026-01-01", "2026-12-31"]) {
      expect(isRealCalendarDate(d)).toBe(true);
    }
  });

  test("rejects days that do not exist, which Date silently overflows", () => {
    // Each of these parses to a REAL but DIFFERENT day, so a NaN check passes
    // them: 2026-02-31 -> 3 March, 2026-02-29 -> 1 March, 2026-04-31 -> 1 May.
    for (const d of ["2026-02-31", "2026-02-29", "2026-04-31", "2026-06-31"]) {
      expect(new Date(`${d}T00:00:00Z`).getTime()).not.toBeNaN();
      expect(isRealCalendarDate(d)).toBe(false);
    }
  });

  test("rejects anything that is not a plain ISO day", () => {
    for (const d of ["", "not-a-date", "2026-13-01", "2026-9-3", "2026-09-03T10:00:00Z"]) {
      expect(isRealCalendarDate(d)).toBe(false);
    }
  });
});
