// P0-04: the economic calendar and the earnings seed fallback rolled a day
// forward every evening.
//
// `new Date().toISOString().slice(0, 10)` converts to UTC before taking the
// date. West of Greenwich that is tomorrow for the whole evening, so from about
// 20:00 Eastern the calendar's "today and the next n days" window slid forward
// and today's events silently became tomorrow's — while the seed fallback
// dropped today's events entirely, because it filtered `date >= t` with `t`
// already set to tomorrow.
//
// WHY THIS FILE SPAWNS SUBPROCESSES. The test runner and CI both run in UTC,
// where local and UTC dates are identical and the defect is invisible. A test
// that runs in-process here could not have caught this and cannot catch its
// return. Each case below runs the real module under a real IANA zone, so the
// fixtures the brief asks for — 00:30 and 21:30 local, across a DST boundary —
// are exercised as the deployed app would experience them.
import { describe, expect, test } from "bun:test";

/** Evaluate an expression against the real module, under a given timezone. */
function underTZ(tz: string, expr: string): unknown {
  const script = `
    const { localIsoDate, nextLocalDays } = await import("${process.cwd()}/src/lib/localDate.ts");
    const { addDaysISO } = await import("${process.cwd()}/src/lib/outcomeGrade.ts");
    console.log(JSON.stringify(${expr}));
  `;
  const r = Bun.spawnSync(["bun", "-e", script], {
    env: { ...process.env, TZ: tz },
    cwd: process.cwd(),
  });
  const out = r.stdout.toString().trim();
  if (r.exitCode !== 0 || !out) {
    throw new Error(`subprocess failed under ${tz}: ${r.stderr.toString()}`);
  }
  return JSON.parse(out);
}

const NY = "America/New_York";
const BERLIN = "Europe/Berlin"; // east of Greenwich: the opposite-sign case

describe("the harness actually reaches a non-UTC timezone", () => {
  // Without this, every assertion below would pass in UTC while proving
  // nothing about the bug — which is exactly how it survived.
  test("the runner is UTC and the subprocess is not", () => {
    expect(new Date(2026, 8, 10, 21, 30).toISOString().slice(0, 10)).toBe("2026-09-10");
    expect(underTZ(NY, `new Date(2026, 8, 10, 21, 30).toISOString().slice(0, 10)`)).toBe(
      "2026-09-11",
    );
  });
});

describe("localIsoDate at the day boundary", () => {
  test("21:30 Eastern is still today, though UTC has rolled over", () => {
    expect(underTZ(NY, `localIsoDate(new Date(2026, 8, 10, 21, 30))`)).toBe("2026-09-10");
  });

  test("00:30 Eastern is the new day", () => {
    expect(underTZ(NY, `localIsoDate(new Date(2026, 8, 10, 0, 30))`)).toBe("2026-09-10");
  });

  test("21:30 Berlin is still today, though UTC has not rolled over", () => {
    expect(underTZ(BERLIN, `localIsoDate(new Date(2026, 8, 10, 21, 30))`)).toBe("2026-09-10");
  });
});

describe("nextLocalDays across the US DST boundary", () => {
  // 1 November 2026: EDT (UTC-4) → EST (UTC-5) at 02:00 local. A window that
  // spans it must still be consecutive calendar days — no repeat, no skip.
  test("the evening before the fall-back gives consecutive local days", () => {
    expect(underTZ(NY, `nextLocalDays(3, new Date(2026, 9, 31, 21, 30))`)).toEqual([
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });

  test("the evening before the spring-forward gives consecutive local days", () => {
    // 8 March 2026: EST → EDT at 02:00 local.
    expect(underTZ(NY, `nextLocalDays(3, new Date(2026, 2, 7, 21, 30))`)).toEqual([
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
    ]);
  });

  test("00:30 on the fall-back day itself does not repeat a date", () => {
    expect(underTZ(NY, `nextLocalDays(2, new Date(2026, 10, 1, 0, 30))`)).toEqual([
      "2026-11-01",
      "2026-11-02",
    ]);
  });

  test("the window starts today, not tomorrow, at 21:30", () => {
    // The defect stated plainly: the first entry was the whole point.
    expect(underTZ(NY, `nextLocalDays(1, new Date(2026, 8, 10, 21, 30))`)).toEqual(["2026-09-10"]);
  });
});

describe("addDaysISO is date-only at both ends", () => {
  // It parsed LOCAL midnight and formatted UTC, so east of Greenwich every
  // grading horizon (1d/1w/1m) landed a day short.
  test("adds a day east of Greenwich", () => {
    expect(underTZ(BERLIN, `addDaysISO("2026-09-10", 1)`)).toBe("2026-09-11");
  });

  test("adds a day west of Greenwich", () => {
    expect(underTZ(NY, `addDaysISO("2026-09-10", 1)`)).toBe("2026-09-11");
  });

  test("a month horizon crosses the US DST boundary intact", () => {
    expect(underTZ(NY, `addDaysISO("2026-10-25", 30)`)).toBe("2026-11-24");
    expect(underTZ(BERLIN, `addDaysISO("2026-10-25", 30)`)).toBe("2026-11-24");
  });

  test("zero days is identity, in either hemisphere of the meridian", () => {
    expect(underTZ(BERLIN, `addDaysISO("2026-09-10", 0)`)).toBe("2026-09-10");
    expect(underTZ(NY, `addDaysISO("2026-09-10", 0)`)).toBe("2026-09-10");
  });
});
