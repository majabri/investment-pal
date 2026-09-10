// The denominator has to be on the SCREEN, not only in the code (P0-05).
//
// `concentration.test.ts` proves the arithmetic and the strings. This proves
// they reach the DOM — a labelling fix that is correct in a pure module and
// never rendered is the same defect it was before.
import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";

import { ConcentrationBreakdown } from "../ConcentrationBreakdown";
import { accountTotals } from "@/lib/accountTotals";
import { denominators } from "@/lib/concentration";

// Synthetic (ADR-APP-012 rules 23-25): invested 80,000 · gross 100,000 · net 70,000.
const positions = [{ quantity: 800, cost_basis: 50, current_price: 100 }];
const known = denominators(accountTotals(positions, { cash: 20_000, margin_used: 30_000 }));

describe("ConcentrationBreakdown", () => {
  test("renders all three percentages, each naming its denominator", () => {
    const { container } = render(<ConcentrationBreakdown positionValue={24_000} denoms={known} />);
    const text = container.textContent ?? "";
    expect(text).toContain("% of net equity");
    expect(text).toContain("% of gross assets");
    expect(text).toContain("% of invested");
    // 24,000 ÷ 70,000 / 100,000 / 80,000 — three different numbers on screen.
    expect(text).toContain("34.3%");
    expect(text).toContain("24.0%");
    expect(text).toContain("30.0%");
  });

  test("an unknown denominator renders the em-dash and says why — never 0.0%", () => {
    const unknown = denominators(accountTotals(positions, { cash: null, margin_used: null }));
    const { container } = render(
      <ConcentrationBreakdown positionValue={24_000} denoms={unknown} />,
    );
    // Read the value cells, not the whole panel: "30.0%" contains "0.0%", so a
    // substring check over the concatenated text cannot tell the two apart.
    const values = [...container.querySelectorAll("dd")].map((el) => el.textContent ?? "");
    expect(values).toEqual(["—not known", "—not known", "30.0%"]);
  });

  test("a zero denominator says 'nothing to divide by', not 'not known'", () => {
    const empty = denominators(accountTotals([], { cash: 0, margin_used: 0 }));
    const { container } = render(<ConcentrationBreakdown positionValue={0} denoms={empty} />);
    const values = [...container.querySelectorAll("dd")].map((el) => el.textContent ?? "");
    expect(values).toEqual([
      "—nothing to divide by",
      "—nothing to divide by",
      "—nothing to divide by",
    ]);
    // An empty account is not an unknown one — different fact, different words.
    expect(container.textContent ?? "").not.toContain("not known");
  });

  test("every row carries the arithmetic, so the label cannot be guessed at", () => {
    const { container } = render(<ConcentrationBreakdown positionValue={24_000} denoms={known} />);
    const text = container.textContent ?? "";
    expect(text).toContain("margin debit");
    expect(text).toContain("Cash is excluded");
  });
});
