// The strip must render UNKNOWN as unknown (audit brief G4).
//
// `householdTotals.test.ts` proves the roll-up produces null. This proves the
// strip does not then print a plausible number: a bare `fmtUSD(null as never)`
// renders "$0.00", and a household that silently drops an account is a smaller,
// believable figure with nothing marking it.
import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import axe from "axe-core";

import { HouseholdStrip } from "../HouseholdStrip";
import type { HouseholdRollup } from "@/lib/householdTotals";

const rollup = (over: Partial<HouseholdRollup> = {}): HouseholdRollup => ({
  total: 50_000,
  totalDay: 250,
  groups: new Map([["Primary", { net: 50_000, day: 250 }]]),
  ...over,
});

describe("HouseholdStrip", () => {
  test("renders the household total and its categories", () => {
    const { container } = render(<HouseholdStrip rollup={rollup()} />);
    const text = container.textContent ?? "";
    expect(text).toContain("Household");
    expect(text).toContain("$50,000.00");
    expect(text).toContain("Primary");
  });

  test("an unknown total renders Unavailable, never $0.00", () => {
    const { container } = render(
      <HouseholdStrip
        rollup={rollup({ total: null, groups: new Map([["Primary", { net: null, day: 250 }]]) })}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Unavailable");
    expect(text).not.toContain("$0.00");
  });

  test("EMPTY: no accounts renders nothing at all", () => {
    const { container } = render(
      <HouseholdStrip rollup={{ total: 0, totalDay: 0, groups: new Map() }} />,
    );
    expect(container.innerHTML).toBe("");
  });

  test("a sub-cent day change is omitted rather than shown as +$0.00", () => {
    const { container } = render(<HouseholdStrip rollup={rollup({ totalDay: 0.004 })} />);
    expect(container.textContent).not.toContain("$0.00");
  });

  test("the day change keeps its sign", () => {
    const up = render(<HouseholdStrip rollup={rollup({ totalDay: 250 })} />);
    expect(up.container.textContent).toContain("+$250.00");
    const down = render(<HouseholdStrip rollup={rollup({ totalDay: -250 })} />);
    expect(down.container.textContent).toContain("-$250.00");
  });

  test("a known day change shows even when the total is unknown", () => {
    // The deliberate asymmetry: quotes are known when balances are not.
    const { container } = render(
      <HouseholdStrip rollup={rollup({ total: null, totalDay: 250 })} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Unavailable");
    expect(text).toContain("+$250.00");
  });

  test("a category outside CATEGORY_ORDER is not rendered", () => {
    // The component renders `CATEGORY_ORDER.filter(...)`, so an unrecognised
    // category is dropped rather than appended. That is deliberate — the order
    // is the display contract — but it means a typo'd category silently
    // vanishes from the strip while still counting in the household total.
    const { container } = render(
      <HouseholdStrip
        rollup={{
          total: 50_000,
          totalDay: 0,
          groups: new Map([["Nonsense", { net: 50_000, day: 0 }]]),
        }}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("$50,000.00"); // counted
    expect(text).not.toContain("Nonsense"); // not shown
  });

  test("no axe violations", async () => {
    const { container } = render(<HouseholdStrip rollup={rollup()} />);
    const r = await axe.run(container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
      rules: { region: { enabled: false } },
    });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});
