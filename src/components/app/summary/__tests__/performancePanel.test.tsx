// The caveat has to be on the SCREEN (PERF-001).
//
// `returnMath.test.ts` proves the arithmetic and `cashFlowPerformance.test.ts`
// proves the coverage rules. This proves the panel actually says which of the
// two things it is showing — a correct return that renders under a heading
// reading "Performance" with no method attached is the same defect in a new
// place.
import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";

import { PerformancePanel } from "../SummaryPanels";
import { balanceSeries } from "@/lib/portfolioSummary";
import type { CashFlowRow } from "@/lib/cashFlows";

// Synthetic (ADR-APP-012 rules 23-25): flat at 100,000, 10,000 deposited on
// the 15th. Value change +10.0%; true return 0.0%.
const series = balanceSeries([
  {
    created_at: "2026-01-01T10:00:00Z",
    snapshot_date: "2026-01-01",
    gross: 100_000,
    net: 100_000,
    margin_used: 0,
  },
  {
    created_at: "2026-01-14T10:00:00Z",
    snapshot_date: "2026-01-14",
    gross: 100_000,
    net: 100_000,
    margin_used: 0,
  },
  {
    created_at: "2026-01-15T10:00:00Z",
    snapshot_date: "2026-01-15",
    gross: 110_000,
    net: 110_000,
    margin_used: 0,
  },
  {
    created_at: "2026-01-31T10:00:00Z",
    snapshot_date: "2026-01-31",
    gross: 110_000,
    net: 110_000,
    margin_used: 0,
  },
]);
const deposit: CashFlowRow[] = [
  { flow_date: "2026-01-15", amount: 10_000, kind: "deposit", treatment: "external" },
];

describe("PerformancePanel", () => {
  test("with no flow history it warns, in words, that these are not returns", () => {
    const { container } = render(
      <PerformancePanel series={series} totals={null} objective={null} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("No cash-flow history is recorded");
    expect(text).toContain("not returns");
    expect(text).toContain("A deposit reads here as a gain");
    // And it does not claim a return anywhere.
    expect(text).not.toContain("time-weighted");
  });

  test("the default prop is the unknown state — a caller cannot forget into a return", () => {
    // No `flows` prop at all, which is how both pages rendered it before this.
    const { container } = render(
      <PerformancePanel series={series} totals={null} objective={null} />,
    );
    expect(container.textContent ?? "").toContain("No cash-flow history is recorded");
  });

  test("with a flow history it shows the return, names the method, and keeps the value change", () => {
    const { container } = render(
      <PerformancePanel
        series={series}
        totals={null}
        objective={null}
        flows={{ coverage: "known", rows: deposit }}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("time-weighted return");
    expect(text).not.toContain("No cash-flow history is recorded");
    // The deposit is disclosed beside the figures it explains.
    expect(text).toContain("deposited/withdrawn");
    // Both numbers are present: 0.0% earned, +$10,000.00 in value.
    expect(text).toContain("0.0%");
    expect(text).toContain("$10,000.00");
    expect(text).toContain("in value");
  });

  test("coverage 'none' is a real answer — a return, with no flow note", () => {
    const { container } = render(
      <PerformancePanel
        series={series}
        totals={null}
        objective={null}
        flows={{ coverage: "none", rows: [] }}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("time-weighted return");
    expect(text).not.toContain("deposited/withdrawn");
    expect(text).not.toContain("No cash-flow history is recorded");
  });
});
