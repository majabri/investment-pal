// The card is the reason gap G2 closes, so these assert what it must never do:
// conflate confidence with probability, hide dissent, or imply a claim is
// sourced when it is not.
import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";

import { DecisionCard, type DecisionRow } from "../DecisionCard";
import { assertNoA11yViolations } from "@/test/a11y";

function row(overrides: Partial<DecisionRow> = {}): DecisionRow {
  return {
    id: "d1",
    recommendation: "Trim NVDA by 15%",
    decision: "pending",
    ...overrides,
  };
}

const populated = row({
  symbol: "NVDA",
  action: "TRIM",
  confidence: 0.72,
  evidence: [{ source_id: "Stooq 2026-08-30", claim: "34% above the 50d MA" }],
  counterargument: "Momentum has persisted through three prior overbought readings.",
  key_risks: ["Re-entry may be higher", "Taxable gain realised"],
  portfolio_impact: { equity_pct: "-2.4" },
  probability_impact: { objective_delta: "+1.5pp" },
  invalidation_conditions: ["Closes above the prior high on volume"],
});

describe("DecisionCard", () => {
  test("shows the recommendation and status without relying on colour alone", () => {
    render(<DecisionCard row={row()} />);
    expect(screen.getByText("Trim NVDA by 15%")).toBeInTheDocument();
    // The dot this replaced had no accessible name.
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  test("confidence is labelled as reasoning confidence, not odds", () => {
    render(<DecisionCard row={populated} />);
    expect(screen.getByText("72%")).toBeInTheDocument();
    expect(
      screen.getByText(/how sure the reasoning is — not the odds of success/i),
    ).toBeInTheDocument();
  });

  test("evidence is collapsed until asked for", () => {
    render(<DecisionCard row={populated} />);
    expect(screen.queryByText(/34% above the 50d MA/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { expanded: false })).toBeInTheDocument();
  });

  test("expanding reveals all eight contract fields", () => {
    render(<DecisionCard row={populated} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByText(/34% above the 50d MA/)).toBeInTheDocument();
    expect(screen.getByText(/Source: Stooq 2026-08-30/)).toBeInTheDocument();
    expect(screen.getByText(/Momentum has persisted/)).toBeInTheDocument();
    expect(screen.getByText("Re-entry may be higher")).toBeInTheDocument();
    expect(screen.getByText("Closes above the prior high on volume")).toBeInTheDocument();
    expect(screen.getByText("-2.4")).toBeInTheDocument();
    expect(screen.getByText("+1.5pp")).toBeInTheDocument();
  });

  test("probability impact is captioned as distinct from confidence", () => {
    render(<DecisionCard row={populated} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(
      screen.getByText(/effect on the odds of reaching the objective — distinct from confidence/i),
    ).toBeInTheDocument();
  });

  test("says when a claim has no recorded source rather than implying one", () => {
    render(<DecisionCard row={row({ evidence: ["an unsourced claim"] })} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("Source not recorded")).toBeInTheDocument();
  });

  test("a partially populated row marks the missing fields as not provided", () => {
    render(<DecisionCard row={row({ counterargument: "only this" })} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    // Five of the six expandable sections have nothing to show.
    expect(screen.getAllByText("Not provided").length).toBeGreaterThan(0);
  });

  test("a row with no contract fields says so, without claiming why", () => {
    render(<DecisionCard row={row()} />);
    expect(screen.getByText(/No evidence recorded for this decision/i)).toBeInTheDocument();
    // Empty columns do not establish *why* they are empty: a post-migration row
    // whose extractor skipped them looks identical to a pre-migration one.
    expect(screen.queryByText(/predates/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("a null inside an impact array never renders as the word null", () => {
    render(<DecisionCard row={row({ portfolio_impact: [null, "real entry"] })} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("real entry")).toBeInTheDocument();
    expect(screen.queryByText("null")).not.toBeInTheDocument();
  });

  test("has no axe violations, collapsed and expanded", async () => {
    const { container } = render(<DecisionCard row={populated} />);
    await assertNoA11yViolations(container);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await assertNoA11yViolations(container);
  });
});
