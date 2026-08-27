import { describe, expect, test } from "bun:test";
import { addDaysISO, closeOnOrAfter, computeOutcome } from "../outcomeGrade";

describe("outcome grading", () => {
  test("uses the first close on or after the requested date", () => {
    expect(
      closeOnOrAfter(
        [
          { date: "2026-01-02", close: 101 },
          { date: "2026-01-05", close: 103 },
        ],
        "2026-01-03",
      ),
    ).toBe(103);
    expect(addDaysISO("2026-01-30", 3)).toBe("2026-02-02");
  });

  test("credits an upward recommendation after a material positive move", () => {
    const result = computeOutcome({
      decidedOn: "2026-01-01",
      priceAtRec: 100,
      action: "BUY",
      recommendation: "Add to the position",
      closes: [
        { date: "2026-01-02", close: 103 },
        { date: "2026-01-08", close: 104 },
        { date: "2026-01-31", close: 106 },
      ],
    });

    expect(result.outcome_1d).toBe(0.03);
    expect(result.grade).toBe("CORRECT");
  });

  test("credits a trim after a material decline and preserves missing horizons", () => {
    const result = computeOutcome({
      decidedOn: "2026-01-01",
      priceAtRec: 100,
      action: "TRIM",
      recommendation: "Reduce on extension",
      closes: [{ date: "2026-01-08", close: 96 }],
    });

    expect(result.outcome_1d).toBe(-0.04);
    expect(result.outcome_1m).toBeNull();
    expect(result.grade).toBe("CORRECT");
  });

  test("stays pending when no grading horizon has settled", () => {
    expect(
      computeOutcome({
        decidedOn: "2026-01-01",
        priceAtRec: 100,
        action: "BUY",
        recommendation: "Add",
        closes: [],
      }).grade,
    ).toBe("PENDING");
  });
});
