// Component tests for the extracted dashboard strips (audit brief G4), and the
// accessibility scope PR #135 abandoned.
//
// Each strip gets three things the brief asks for: it renders its rows, it
// renders NOTHING when it has none, and it has no axe violations. The empty
// case is the one that would otherwise go untested and is the one that ships
// most often — most accounts have no plan and no trims on most days.
import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import axe from "axe-core";

import { BuybackStrip, TodaysPlanStrip } from "../DashboardStrips";
import type { BuybackPlanRow, PlanRow } from "../DashboardStrips";

/** Synthetic throughout (ADR-APP-012 rules 23-25). */
const plan: PlanRow[] = [
  { id: "1", recommendation: "TRIM 20% of NVDA into strength", decision: "pending" },
  { id: "2", recommendation: "ADD to MSFT on the 200-day", decision: "followed" },
];

const buyback: BuybackPlanRow[] = [
  {
    symbol: "NVDA",
    decidedOn: "2026-08-14",
    anchor: 120.5,
    zones: [
      { pct: 5, price: 114.48, status: "hit" },
      { pct: 10, price: 108.45, status: "open" },
    ],
  },
];

async function violations(container: HTMLElement) {
  const results = await axe.run(container, {
    // The strips are fragments of a page; landmark and page-level rules need
    // the whole document and would fail on any component rendered alone.
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    rules: { region: { enabled: false } },
  });
  return results.violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`);
}

describe("TodaysPlanStrip", () => {
  test("renders every line", () => {
    const { container } = render(<TodaysPlanStrip rows={plan} />);
    const text = container.textContent ?? "";
    expect(text).toContain("TRIM 20% of NVDA into strength");
    expect(text).toContain("ADD to MSFT on the 200-day");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  test("EMPTY: renders nothing at all — not an empty box", () => {
    // An advisory strip with an empty list trains the eye to skip the region,
    // and the strips that matter live in the same region.
    const { container } = render(<TodaysPlanStrip rows={[]} />);
    expect(container.innerHTML).toBe("");
  });

  test("pending vs settled is not carried by colour alone (#135)", () => {
    const { container } = render(<TodaysPlanStrip rows={plan} />);
    const text = container.textContent ?? "";
    expect(text).toContain("Pending:");
    expect(text).toContain("Settled:");
    // The coloured bullet is decoration and is hidden from the a11y tree.
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  test("has an accessible name, so the region is navigable", () => {
    const { container } = render(<TodaysPlanStrip rows={plan} />);
    expect(container.querySelector('section[aria-label="Today\'s Plan"]')).not.toBeNull();
  });

  test("no axe violations", async () => {
    const { container } = render(<TodaysPlanStrip rows={plan} />);
    expect(await violations(container)).toEqual([]);
  });
});

describe("BuybackStrip", () => {
  test("renders the ladder, with reached rungs marked in text", () => {
    const { container } = render(<BuybackStrip plans={buyback} />);
    const text = container.textContent ?? "";
    expect(text).toContain("NVDA");
    expect(text).toContain("08-14");
    expect(text).toContain("5%");
    expect(text).toContain("10%");
    // "hit" is shown as words, not only as a colour.
    expect(text).toContain("✓ reached");
  });

  test("EMPTY: renders nothing at all", () => {
    const { container } = render(<BuybackStrip plans={[]} />);
    expect(container.innerHTML).toBe("");
  });

  test("keeps the advisory caveat — the anchor is a logged price, not a fill", () => {
    // The app recommends; the holder trades at the broker. Every price in the
    // ladder is derived from a logged trim price, so dropping this line would
    // present an approximation of an approximation as an order.
    const { container } = render(<BuybackStrip plans={buyback} />);
    const text = container.textContent ?? "";
    expect(text).toContain("your broker's fill may differ");
    expect(text).toContain("Advisory only");
  });

  test("no axe violations", async () => {
    const { container } = render(<BuybackStrip plans={buyback} />);
    expect(await violations(container)).toEqual([]);
  });

  test("NEGATIVE CONTROL: axe actually reports a violation when there is one", async () => {
    // Without this, five green axe assertions would prove only that axe ran.
    const { container } = render(
      <div>
        <img src="x.png" />
      </div>,
    );
    expect(await violations(container)).not.toEqual([]);
  });
});

