// The goal-probability model and how its answer reaches the screen.
//
// The defect this pins: `probabilityOfReachingTarget` returned 0 when it had
// nothing to project from (no current value) or over (no horizon), and the
// dashboard alerted that as "Probability of reaching the goal is 0%" — a
// claim about the plan made from a missing input. Unknown is not zero; a tiny
// probability is not "0%" either. Figures here are synthetic.
import { describe, expect, test } from "bun:test";

import { fmtProbability, probabilityOfReachingTarget } from "../finance";
import { GOAL_PACE_FLOOR, raiseAlerts, type AlertInput } from "../alerts";

const quiet: AlertInput = {
  constitution: { breaches: [], checkable: true, capsAreDefaults: false },
  sources: [],
  positionsStaleDays: 0,
  valuationUnknown: false,
  reconciliation: null,
  fillMismatches: null,
  goalProbability: null,
  upcomingEvents: [],
};

describe("probabilityOfReachingTarget", () => {
  test("nothing to project from is NULL, not 0%", () => {
    expect(probabilityOfReachingTarget(0, 1_000, 5, 0.1, 0.2)).toBeNull();
    expect(probabilityOfReachingTarget(-5, 1_000, 5, 0.1, 0.2)).toBeNull();
  });

  test("no horizon is NULL, not 0%", () => {
    expect(probabilityOfReachingTarget(500, 1_000, 0, 0.1, 0.2)).toBeNull();
    expect(probabilityOfReachingTarget(500, 1_000, -1, 0.1, 0.2)).toBeNull();
  });

  test("a non-finite input or a zero volatility is NULL, never NaN", () => {
    expect(probabilityOfReachingTarget(Number.NaN, 1_000, 5, 0.1, 0.2)).toBeNull();
    expect(probabilityOfReachingTarget(500, 1_000, 5, 0.1, 0)).toBeNull();
  });

  test("already at or past the target is a certainty, which is a fact", () => {
    expect(probabilityOfReachingTarget(1_000, 1_000, 5, 0.1, 0.2)).toBe(1);
    expect(probabilityOfReachingTarget(1_500, 1_000, 5, 0.1, 0.2)).toBe(1);
  });

  test("otherwise a probability strictly between 0 and 1 — the negative control", () => {
    const p = probabilityOfReachingTarget(500, 1_000, 5, 0.1, 0.2);
    expect(p).not.toBeNull();
    expect(p as number).toBeGreaterThan(0);
    expect(p as number).toBeLessThan(1);
  });

  test("more time and more expected return raise it; a further target lowers it", () => {
    const base = probabilityOfReachingTarget(500, 1_000, 5, 0.1, 0.2) as number;
    expect(probabilityOfReachingTarget(500, 1_000, 10, 0.1, 0.2) as number).toBeGreaterThan(base);
    expect(probabilityOfReachingTarget(500, 1_000, 5, 0.14, 0.2) as number).toBeGreaterThan(base);
    expect(probabilityOfReachingTarget(500, 2_000, 5, 0.1, 0.2) as number).toBeLessThan(base);
  });

  test("a genuinely remote target is a tiny number, not NULL — remote is known", () => {
    const p = probabilityOfReachingTarget(1, 1_000_000_000, 0.01, 0.07, 0.12);
    expect(p).not.toBeNull();
    expect(p as number).toBeGreaterThanOrEqual(0);
    expect(p as number).toBeLessThan(0.001);
  });
});

describe("fmtProbability", () => {
  test("NULL is the em-dash, never a percentage", () => {
    expect(fmtProbability(null)).toBe("—");
    expect(fmtProbability(null, 0)).toBe("—");
    expect(fmtProbability(null)).not.toContain("%");
  });

  test("an ordinary probability prints like any percentage", () => {
    expect(fmtProbability(0.62)).toBe("62.0%");
    expect(fmtProbability(0.62, 0)).toBe("62%");
  });

  test("a small probability is a bound, not 0%", () => {
    expect(fmtProbability(0.0004)).toBe("<0.1%");
    expect(fmtProbability(0.004, 0)).toBe("<1%");
    expect(fmtProbability(0.0004)).not.toBe("0.0%");
  });

  test("a near-certainty is a bound, not 100%", () => {
    expect(fmtProbability(0.9996)).toBe(">99.9%");
    expect(fmtProbability(0.996, 0)).toBe(">99%");
  });

  test("exactly 0 and exactly 1 are facts and print as such", () => {
    expect(fmtProbability(0)).toBe("0.0%");
    expect(fmtProbability(1)).toBe("100.0%");
  });

  test("a broken number is marked broken, not shown", () => {
    expect(fmtProbability(Number.NaN)).toBe("(error)");
  });
});

describe("the goal-pace alert", () => {
  test("says nothing when the probability is unknown", () => {
    expect(raiseAlerts({ ...quiet, goalProbability: null }).filter((a) => a.type === "goal_pace")).toEqual([]);
  });

  test("a tiny probability is alerted as a bound, never as 0%", () => {
    const [a] = raiseAlerts({ ...quiet, goalProbability: 0.003 }).filter((x) => x.type === "goal_pace");
    expect(a).toBeDefined();
    expect(a!.message).toContain("<1%");
    expect(a!.message).not.toContain(" 0%");
  });

  test("an ordinary low probability is alerted with its figure — the negative control", () => {
    const [a] = raiseAlerts({ ...quiet, goalProbability: GOAL_PACE_FLOOR - 0.1 }).filter((x) => x.type === "goal_pace");
    expect(a!.message).toContain(`${Math.round((GOAL_PACE_FLOOR - 0.1) * 100)}%`);
  });
});
