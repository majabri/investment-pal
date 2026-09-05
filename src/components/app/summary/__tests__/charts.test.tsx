// Runtime proof for the recharts 3 upgrade.
//
// A green `tsc` is not evidence that a major dependency bump works: the zod 3/4
// incident (ADR-APP-005) typechecked cleanly and broke the app at boot. recharts
// 3 reorganised its internals, so these render the two chart-bearing panels for
// real and assert they mount without throwing.
//
// What this does NOT prove: that the drawn chart looks right. `ResponsiveContainer`
// measures its parent, and happy-dom reports every element as zero-sized, so the
// SVG body is not laid out here. Mounting is the part that breaks on a major
// bump; pixels still want a human eye.
import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";

import { AllocationPanel, BalanceOverTime } from "../SummaryPanels";
import type { AccountScope } from "@/lib/accountTotals";
import { balanceSeries } from "@/lib/portfolioSummary";

const scope: AccountScope = {
  kind: "account",
  accountId: "acct-1",
  accountName: "Amir — TOD",
};

const series = balanceSeries([
  {
    created_at: "2026-09-01T10:00:00Z",
    snapshot_date: "2026-09-01",
    gross: 60_000,
    net: 53_000,
    margin_used: 7_000,
  },
  {
    created_at: "2026-09-02T10:00:00Z",
    snapshot_date: "2026-09-02",
    gross: 60_400,
    net: 53_500,
    margin_used: 6_900,
  },
  {
    created_at: "2026-09-03T10:00:00Z",
    snapshot_date: "2026-09-03",
    gross: 60_602.68,
    net: 53_938.35,
    margin_used: 6_664.33,
  },
]);

describe("BalanceOverTime under recharts 3", () => {
  test("mounts with a real series without throwing", () => {
    const { container } = render(
      <BalanceOverTime scope={scope} series={series} unscopedCount={0} />,
    );
    expect(container).toBeInTheDocument();
  });

  test("still renders its range buttons", () => {
    // The range selector is ours, not recharts', so it must survive regardless
    // of how the chart body lays out in a zero-sized document.
    const { getByText } = render(
      <BalanceOverTime scope={scope} series={series} unscopedCount={0} />,
    );
    for (const label of ["1M", "3M", "6M", "1Y", "All"]) {
      expect(getByText(label)).toBeInTheDocument();
    }
  });

  test("the empty state renders without touching recharts at all", () => {
    const { getByText } = render(<BalanceOverTime scope={scope} series={[]} unscopedCount={0} />);
    expect(getByText(/No balance history recorded/)).toBeInTheDocument();
  });
});

describe("AllocationPanel under recharts 3", () => {
  const positions = [
    { sector: "Technology", quantity: 100, current_price: 606.023 },
    { sector: "Healthcare", quantity: 10, current_price: 50 },
    { sector: null, quantity: 5, current_price: 20 },
  ];

  test("mounts a doughnut without throwing", () => {
    const { container } = render(<AllocationPanel positions={positions} noScope={false} />);
    expect(container).toBeInTheDocument();
  });

  test("the share table renders beside the chart, including Unclassified", () => {
    // The text figures are ours and are the part a reader can actually check,
    // so they must render even where the SVG does not lay out.
    const { getByText } = render(<AllocationPanel positions={positions} noScope={false} />);
    expect(getByText("Technology")).toBeInTheDocument();
    expect(getByText("Unclassified")).toBeInTheDocument();
  });

  test("no positions renders the empty state, not an empty doughnut", () => {
    const { getByText } = render(<AllocationPanel positions={[]} noScope={false} />);
    expect(getByText(/No positions in this account/)).toBeInTheDocument();
  });
});
