// What needs attention, in one place (§23.1).
//
// The conditions mostly existed; what did not was one surface answering "what
// needs my attention?", with each condition visible only to somebody already
// on the screen that renders it.
//
// The rule these guard hardest: an empty alert list must mean every evaluator
// RAN and found nothing — never that nothing was checked.
import { describe, expect, test } from "bun:test";
import {
  ALERT_TYPES,
  GOAL_PACE_FLOOR,
  POSITIONS_STALE_DAYS,
  UNBUILT_ALERT_TYPES,
  alertCounts,
  raiseAlerts,
} from "@/lib/alerts";
import type { AlertInput } from "@/lib/alerts";
import { SOURCES } from "@/lib/sourceHealth";

const quiet: AlertInput = {
  constitution: { breaches: [], checkable: true, capsAreDefaults: false },
  sources: [],
  positionsStaleDays: 0,
  valuationUnknown: false,
  goalProbability: 0.8,
  upcomingEvents: [],
};

describe("nothing wrong raises nothing", () => {
  test("a healthy state is an empty list", () => {
    expect(raiseAlerts(quiet)).toEqual([]);
  });
});

describe("a check that could not run is itself the alert", () => {
  test("UNCHECKABLE policy raises critical — it is not a clean result", () => {
    // The alert that would otherwise be silent: no breaches, because nothing
    // was evaluated. This is the whole reason the aggregator reads `checkable`
    // rather than `breaches.length`.
    const alerts = raiseAlerts({
      ...quiet,
      constitution: { breaches: [], checkable: false, capsAreDefaults: false },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("missing_valuation");
    expect(alerts[0].severity).toBe("critical");
    expect(alerts[0].message).toContain("not a clean result");
  });

  test("an unknown account value raises, rather than contributing nothing", () => {
    const alerts = raiseAlerts({ ...quiet, valuationUnknown: true });
    expect(alerts.some((a) => a.type === "missing_valuation")).toBe(true);
  });

  test("an UNCOMPUTABLE goal probability raises NOTHING — it is not a low one", () => {
    // Alerting here would be a claim about the plan that the app cannot make.
    expect(raiseAlerts({ ...quiet, goalProbability: null })).toEqual([]);
  });
});

describe("breaches carry their type", () => {
  test("a margin breach and a position breach are different types", () => {
    const alerts = raiseAlerts({
      ...quiet,
      constitution: {
        breaches: [
          "NVDA 34.3% of net equity > 30% cap",
          "Margin util 42.9% of net equity > 25% cap",
        ],
        checkable: true,
        capsAreDefaults: false,
      },
    });
    expect(alerts.map((a) => a.type).sort()).toEqual(["concentration_breach", "margin_threshold"]);
    expect(alerts.every((a) => a.severity === "critical")).toBe(true);
  });
});

describe("staleness", () => {
  test("NEVER imported is worse than stale, not better", () => {
    const alerts = raiseAlerts({ ...quiet, positionsStaleDays: null });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain("never been imported");
  });

  test("fresh raises nothing; past the floor raises", () => {
    expect(raiseAlerts({ ...quiet, positionsStaleDays: POSITIONS_STALE_DAYS - 1 })).toEqual([]);
    expect(raiseAlerts({ ...quiet, positionsStaleDays: POSITIONS_STALE_DAYS })).toHaveLength(1);
  });
});

describe("source failures", () => {
  test("a failing source raises with what it breaks", () => {
    const alerts = raiseAlerts({
      ...quiet,
      sources: [{ descriptor: SOURCES[3], coverage: "UNAVAILABLE", lastOkAt: null }],
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("data_source_failure");
    expect(alerts[0].message).toContain(SOURCES[3].impact);
  });

  test("a LOADING source raises nothing — it has not failed", () => {
    expect(
      raiseAlerts({
        ...quiet,
        sources: [{ descriptor: SOURCES[3], coverage: "LOADING", lastOkAt: null }],
      }),
    ).toEqual([]);
  });
});

describe("ordering and counting", () => {
  test("worst first", () => {
    const alerts = raiseAlerts({
      ...quiet,
      constitution: { breaches: ["NVDA over cap"], checkable: true, capsAreDefaults: false },
      positionsStaleDays: 5,
      upcomingEvents: [{ date: "2026-09-12", text: "NVDA earnings" }],
    });
    expect(alerts.map((a) => a.severity)).toEqual(["critical", "warning", "info"]);
  });

  test("counts match the list", () => {
    const alerts = raiseAlerts({
      ...quiet,
      constitution: { breaches: ["NVDA over cap"], checkable: true, capsAreDefaults: false },
      positionsStaleDays: 5,
    });
    expect(alertCounts(alerts)).toEqual({ critical: 1, warning: 1, info: 0 });
  });

  test("goal pace fires below the floor and not at it", () => {
    expect(raiseAlerts({ ...quiet, goalProbability: GOAL_PACE_FLOOR })).toEqual([]);
    expect(raiseAlerts({ ...quiet, goalProbability: GOAL_PACE_FLOOR - 0.01 })).toHaveLength(1);
  });
});

describe("the unbuilt types are declared, not omitted", () => {
  test("every §23.1 type is named in ALERT_TYPES", () => {
    expect(ALERT_TYPES).toHaveLength(11);
  });

  test("each unbuilt type gives a reason", () => {
    // A list of seven that looks like a list of eleven is the same defect as a
    // health panel showing four sources of seven.
    for (const [type, reason] of Object.entries(UNBUILT_ALERT_TYPES)) {
      expect(ALERT_TYPES).toContain(type as (typeof ALERT_TYPES)[number]);
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  test("no unbuilt type is ever raised", () => {
    // If one starts being raised, it should leave UNBUILT_ALERT_TYPES in the
    // same change — otherwise the declared gap and the real one drift apart.
    const everything = raiseAlerts({
      ...quiet,
      constitution: { breaches: ["NVDA over cap"], checkable: true, capsAreDefaults: false },
      sources: SOURCES.map((d) => ({
        descriptor: d,
        coverage: "UNAVAILABLE" as const,
        lastOkAt: null,
      })),
      positionsStaleDays: null,
      valuationUnknown: true,
      goalProbability: 0.1,
      upcomingEvents: [{ date: "2026-09-12", text: "NVDA earnings" }],
    });
    for (const a of everything) {
      expect(UNBUILT_ALERT_TYPES[a.type]).toBeUndefined();
    }
  });
});
