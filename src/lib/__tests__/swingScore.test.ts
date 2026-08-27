import { describe, expect, test } from "bun:test";
import { computeSwing, rsi14, tradingDaysUntil } from "../swingScore";

describe("swing score", () => {
  test("does not score when the required history is unavailable", () => {
    expect(computeSwing(Array.from({ length: 49 }, () => 100))).toEqual({
      insufficient: true,
      band: "none",
      suggestion: null,
    });
  });

  test("flags a materially extended price series as a large-trim review", () => {
    const result = computeSwing(Array.from({ length: 50 }, (_, index) => 100 + index));

    expect(result.insufficient).toBe(false);
    expect(result.rsi).toBe(100);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.band).toBe("trim-large");
    expect(result.suggestion).toBe("Consider trim 25–50%");
  });

  test("withholds a trim suggestion near earnings", () => {
    const result = computeSwing(
      Array.from({ length: 50 }, (_, index) => 100 + index),
      3,
    );

    expect(result.band).toBe("earnings-hold");
    expect(result.suggestion).toBe("Earnings in 3d — hold trim decision");
  });

  test("counts weekdays while explicitly excluding weekends", () => {
    expect(tradingDaysUntil("2026-01-12", new Date("2026-01-09T12:00:00Z"))).toBe(1);
    expect(rsi14(Array.from({ length: 15 }, () => 100))).toBe(100);
  });
});
