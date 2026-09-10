// "What is working right now?" must not answer "everything" when it is not
// (OBS-001).
//
// The audit's finding was "no data_source_health, no health surface". This
// covers the surface. History needs persistence and is deliberately not built:
// a fourth unapplied migration answering a question nobody has asked is worse
// than answering the one being asked.
import { describe, expect, test } from "bun:test";
import { SOURCES, healthCounts, healthSummary, overallHealth } from "@/lib/sourceHealth";
import type { SourceHealth } from "@/lib/sourceHealth";
import type { Coverage } from "@/lib/coverage";

const entry = (id: number, coverage: Coverage): SourceHealth => ({
  descriptor: SOURCES[id],
  coverage,
  lastOkAt: coverage === "AVAILABLE" ? "2026-09-10T19:00:00Z" : null,
});

describe("overallHealth", () => {
  test("nothing checked yet is loading, not ok", () => {
    expect(overallHealth([])).toBe("loading");
    expect(overallHealth([entry(0, "LOADING"), entry(1, "LOADING")])).toBe("loading");
  });

  test("everything answered is ok", () => {
    expect(overallHealth([entry(0, "AVAILABLE"), entry(1, "AVAILABLE")])).toBe("ok");
  });

  test("ONE failure is degraded, not ok", () => {
    // The failure mode this exists to prevent: a banner that says "all good"
    // while the earnings source has been dead all morning.
    expect(overallHealth([entry(0, "AVAILABLE"), entry(1, "UNAVAILABLE")])).toBe("degraded");
  });

  test("one failure is degraded, NOT down — the free feeds fail independently", () => {
    // Calling one dead headline source an outage trains the eye to ignore the
    // banner, which costs more than the source did.
    const many = [entry(0, "AVAILABLE"), entry(1, "AVAILABLE"), entry(2, "UNAVAILABLE")];
    expect(overallHealth(many)).toBe("degraded");
  });

  test("everything that finished has failed is down", () => {
    expect(overallHealth([entry(0, "UNAVAILABLE"), entry(1, "UNAVAILABLE")])).toBe("down");
  });

  test("a page with six live and one in flight is NOT loading", () => {
    const mixed = [...[0, 1, 2, 3, 4, 5].map((i) => entry(i, "AVAILABLE")), entry(6, "LOADING")];
    expect(overallHealth(mixed)).toBe("ok");
  });

  test("still loading alongside a known failure is degraded, not loading", () => {
    // A failure already observed is not erased by something else still running.
    expect(overallHealth([entry(0, "UNAVAILABLE"), entry(1, "LOADING")])).toBe("down");
    expect(
      overallHealth([entry(0, "AVAILABLE"), entry(1, "UNAVAILABLE"), entry(2, "LOADING")]),
    ).toBe("degraded");
  });
});

describe("healthSummary", () => {
  test("never says all good while something is failing", () => {
    const s = healthSummary([entry(0, "AVAILABLE"), entry(1, "UNAVAILABLE")]);
    expect(s).toContain("did not answer");
    expect(s).not.toContain("All");
  });

  test("counts what it says it counts", () => {
    const entries = [entry(0, "AVAILABLE"), entry(1, "UNAVAILABLE"), entry(2, "LOADING")];
    expect(healthSummary(entries)).toBe("1 of 3 data sources did not answer.");
  });

  test("all-ok names the number", () => {
    expect(healthSummary([entry(0, "AVAILABLE"), entry(1, "AVAILABLE")])).toBe(
      "All 2 data sources answered.",
    );
  });

  test("nothing answered says so plainly", () => {
    expect(healthSummary([entry(0, "UNAVAILABLE")])).toContain("No data source answered");
  });

  test("loading says it is checking, and claims nothing", () => {
    const s = healthSummary([entry(0, "LOADING")]);
    expect(s).toContain("Checking");
    expect(s).not.toContain("answered.");
  });
});

describe("healthCounts", () => {
  test("the three states are counted separately", () => {
    const c = healthCounts([
      entry(0, "AVAILABLE"),
      entry(1, "AVAILABLE"),
      entry(2, "UNAVAILABLE"),
      entry(3, "LOADING"),
    ]);
    expect(c).toEqual({ ok: 2, failing: 1, loading: 1 });
  });
});

describe("the source list", () => {
  test("every source names a provider and an impact", () => {
    // A failure with no named provider points nowhere, and one with no impact
    // cannot be triaged against the others.
    for (const s of SOURCES) {
      expect(s.provider.length).toBeGreaterThan(0);
      expect(s.impact.length).toBeGreaterThan(10);
    }
  });

  test("ids are unique", () => {
    expect(new Set(SOURCES.map((s) => s.id)).size).toBe(SOURCES.length);
  });

  test("no impact line says a failure means 'none'", () => {
    // The whole rule 30 distinction: an unavailable source is UNKNOWN, never
    // an empty result. An impact line that says otherwise would be teaching
    // the wrong reading in the one place meant to correct it.
    for (const s of SOURCES) {
      expect(s.impact.toLowerCase()).not.toMatch(/\bmeans none\b|\bshows none\b|\bno events\b/);
    }
  });
});
