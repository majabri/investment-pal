// A figure's age is part of the figure. Before this, `account_balances`
// recorded `imported_at` and nothing read it — so a balance pasted three months
// ago rendered exactly like one pasted this morning.
import { describe, expect, test } from "bun:test";

import {
  freshnessOf,
  freshnessLabel,
  isDecisionGrade,
  DEFAULT_STALENESS,
  type Freshness,
  type Provenance,
} from "../freshness";

const NOW = new Date("2026-09-05T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const p = (over: Partial<Provenance> = {}): Provenance => ({
  sourceType: "imported_snapshot",
  asOf: hoursAgo(1),
  ...over,
});

describe("no figure means nothing to be fresh about", () => {
  test("a missing value is UNAVAILABLE whatever its provenance says", () => {
    // Checked first, on purpose. A missing figure reported as "current" is both
    // defects at once: it fabricates a value AND vouches for it.
    for (const v of [null, undefined, Number.NaN]) {
      expect(freshnessOf(v, p({ sourceType: "live_quote", asOf: hoursAgo(0) }), NOW)).toBe(
        "UNAVAILABLE",
      );
    }
  });

  test("a real zero is a figure and gets a real state", () => {
    expect(freshnessOf(0, p({ sourceType: "live_quote", asOf: hoursAgo(0) }), NOW)).toBe("CURRENT");
  });
});

describe("unknown provenance is its own state, not stale", () => {
  test("no source type is UNKNOWN", () => {
    expect(freshnessOf(100, p({ sourceType: null }), NOW)).toBe("UNKNOWN");
  });

  test("no as-of is UNKNOWN", () => {
    // Distinct from STALE because the fix differs: recording provenance, not
    // importing again.
    expect(freshnessOf(100, p({ asOf: null }), NOW)).toBe("UNKNOWN");
  });

  test("an unparseable as-of is UNKNOWN, not a crash and not CURRENT", () => {
    expect(freshnessOf(100, p({ asOf: "whenever" }), NOW)).toBe("UNKNOWN");
  });

  test("a figure stamped in the future is UNKNOWN, not CURRENT", () => {
    // A clock error must not read as the best possible data.
    expect(freshnessOf(100, p({ asOf: hoursAgo(-5) }), NOW)).toBe("UNKNOWN");
  });
});

describe("each source type has its own window", () => {
  const cases: Array<[Provenance["sourceType"], number, Freshness, Freshness]> = [
    // [type, window hours, fresh state, state past the window]
    ["live_quote", DEFAULT_STALENESS.live_quote, "CURRENT", "STALE"],
    ["delayed_quote", DEFAULT_STALENESS.delayed_quote, "DELAYED", "STALE"],
    ["imported_snapshot", DEFAULT_STALENESS.imported_snapshot, "IMPORTED_SNAPSHOT", "STALE"],
    ["user_entry", DEFAULT_STALENESS.user_entry, "CURRENT", "STALE"],
  ];

  for (const [sourceType, window, fresh, aged] of cases) {
    test(`${sourceType}: inside its window`, () => {
      expect(freshnessOf(100, { sourceType, asOf: hoursAgo(window / 2) }, NOW)).toBe(fresh);
    });

    test(`${sourceType}: past its window`, () => {
      expect(freshnessOf(100, { sourceType, asOf: hoursAgo(window + 1) }, NOW)).toBe(aged);
    });
  }

  test("a quote goes stale in hours where a balance does not", () => {
    // The point of per-type windows: one global number would either call a
    // day-old quote fine or a day-old balance stale, and both are wrong.
    const dayOld = hoursAgo(24);
    expect(freshnessOf(100, { sourceType: "live_quote", asOf: dayOld }, NOW)).toBe("STALE");
    expect(freshnessOf(100, { sourceType: "imported_snapshot", asOf: dayOld }, NOW)).toBe(
      "IMPORTED_SNAPSHOT",
    );
  });

  test("the windows are configurable, not compiled in", () => {
    const strict = { ...DEFAULT_STALENESS, imported_snapshot: 1 };
    expect(freshnessOf(100, { sourceType: "imported_snapshot", asOf: hoursAgo(2) }, NOW, strict)).toBe(
      "STALE",
    );
  });

  test("no window is a function of portfolio size", () => {
    // Rule 31. The same figure at $500 and at $5,000,000 is the same age.
    for (const value of [500, 50_000, 5_000_000]) {
      expect(freshnessOf(value, p({ asOf: hoursAgo(1) }), NOW)).toBe("IMPORTED_SNAPSHOT");
    }
  });
});

describe("which states may carry a decision", () => {
  test("current, delayed and snapshot may; the rest may not", () => {
    expect(isDecisionGrade("CURRENT")).toBe(true);
    expect(isDecisionGrade("DELAYED")).toBe(true);
    // A snapshot is CORRECT for a balance — it is what the broker said, when
    // they said it — so refusing it would block every portfolio decision.
    expect(isDecisionGrade("IMPORTED_SNAPSHOT")).toBe(true);

    expect(isDecisionGrade("STALE")).toBe(false);
    expect(isDecisionGrade("UNKNOWN")).toBe(false);
    expect(isDecisionGrade("UNAVAILABLE")).toBe(false);
  });
});

describe("every state says something", () => {
  test("no state renders as an empty label", () => {
    const all: Freshness[] = [
      "CURRENT",
      "DELAYED",
      "IMPORTED_SNAPSHOT",
      "STALE",
      "UNKNOWN",
      "UNAVAILABLE",
    ];
    for (const f of all) expect(freshnessLabel(f).length).toBeGreaterThan(0);
  });

  test("the two states with no date do not claim one", () => {
    expect(freshnessLabel("UNKNOWN", "2026-09-01T00:00:00Z")).not.toContain("2026");
    expect(freshnessLabel("UNAVAILABLE", "2026-09-01T00:00:00Z")).not.toContain("2026");
  });

  test("a dated state carries its date", () => {
    expect(freshnessLabel("IMPORTED_SNAPSHOT", "2026-09-01T00:00:00Z")).toContain("2026-09-01");
  });
});
