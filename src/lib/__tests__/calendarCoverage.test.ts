// BR-008 / §15.4 / §26.2 "feed failure differs from successful no-event result".
//
// Before this module, a week in which every provider request failed and a week
// with no scheduled events both reached the client as the same empty list.
import { describe, expect, test } from "bun:test";

import { collectCalendar, isQuietPeriod } from "@/lib/calendarCoverage";
import type { DayFetch } from "@/lib/calendarCoverage";

type Ev = { date: string; name: string };
const ok = (...rows: Ev[]): DayFetch<Ev> => ({ ok: true, rows });
const down: DayFetch<Ev> = { ok: false };

describe("collectCalendar", () => {
  test("NEGATIVE CONTROL: days that answered with rows are rows", () => {
    const o = collectCalendar([ok({ date: "d1", name: "CPI" }), ok({ date: "d2", name: "FOMC" })]);
    expect(o.kind).toBe("rows");
    if (o.kind === "rows") {
      expect(o.rows.map((r) => r.name)).toEqual(["CPI", "FOMC"]);
      expect(o.fetched).toBe(2);
      expect(o.failed).toBe(0);
    }
  });

  test("every day failing is UNAVAILABLE — not an empty calendar", () => {
    // The defect. A fully blocked provider used to come back as `[]`, which
    // the client rendered as "No events in the next N days."
    const o = collectCalendar([down, down, down]);
    expect(o).toEqual({ kind: "unavailable", failed: 3 });
  });

  test("every day answering with nothing is a QUIET PERIOD — not unavailable", () => {
    // The other half of the defect. A quiet week used to throw `Error("empty")`
    // and reach the readiness gate as a dead feed.
    const o = collectCalendar([ok(), ok(), ok()]);
    expect(o).toEqual({ kind: "rows", rows: [], fetched: 3, failed: 0 });
    expect(isQuietPeriod(o)).toBe(true);
  });

  test("no days at all is unavailable, not quiet", () => {
    // Nothing was asked, so nothing can be said. `fetched === 0` is the test,
    // and it holds whether the list is empty or all failures.
    expect(collectCalendar([])).toEqual({ kind: "unavailable", failed: 0 });
  });

  test("a partial answer is rows with the failed days COUNTED", () => {
    // One day answered, two did not. The one row is real; the list is a lower
    // bound, and the count is what lets a caller say so.
    const o = collectCalendar([down, ok({ date: "d2", name: "PPI" }), down]);
    expect(o.kind).toBe("rows");
    if (o.kind === "rows") {
      expect(o.rows).toHaveLength(1);
      expect(o.fetched).toBe(1);
      expect(o.failed).toBe(2);
    }
  });

  test("a partial answer with no rows is still a quiet period on the days that answered", () => {
    const o = collectCalendar([down, ok()]);
    expect(o.kind).toBe("rows");
    expect(isQuietPeriod(o)).toBe(true);
    if (o.kind === "rows") expect(o.failed).toBe(1);
  });

  test("rows keep their day order", () => {
    const o = collectCalendar([ok({ date: "d1", name: "a" }), ok({ date: "d2", name: "b" }, { date: "d2", name: "c" })]);
    if (o.kind === "rows") expect(o.rows.map((r) => r.name)).toEqual(["a", "b", "c"]);
    else throw new Error("expected rows");
  });
});

describe("isQuietPeriod", () => {
  test("unavailable is NOT quiet — nothing was learned", () => {
    expect(isQuietPeriod(collectCalendar([down]))).toBe(false);
  });

  test("rows present is not quiet", () => {
    expect(isQuietPeriod(collectCalendar([ok({ date: "d", name: "x" })]))).toBe(false);
  });
});
