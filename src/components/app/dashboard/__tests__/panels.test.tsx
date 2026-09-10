// The two decision-support panels (audit brief G4).
//
// Each carries one rule worth a test, and the two rules are opposites — which
// is why they are not the same component and why "render nothing when empty"
// is not a blanket policy:
//
//   * GoalOutlookPanel: NO progress bar when progress is unknown. A bar at 0%
//     is a claim of no progress, and unknown is not zero.
//   * PrioritiesPanel: an empty list SAYS it is empty. A panel that vanishes
//     when there is nothing to show cannot be told apart from one that failed
//     to load.
import { describe, expect, mock, test } from "bun:test";
import { render, fireEvent } from "@testing-library/react";
import axe from "axe-core";

// Both panels link out; a real router renders asynchronously and the DOM would
// be empty at assertion time. Routing is the router's test.
mock.module("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const { GoalOutlookPanel } = await import("../GoalOutlookPanel");
const { PrioritiesPanel } = await import("../PrioritiesPanel");
import type { GoalMetrics } from "../GoalOutlookPanel";
import type { Priority } from "../PrioritiesPanel";

const metrics: GoalMetrics = { cagr: 0.14, prob: 0.62, years: 1.55, progress: 0.4 };

async function violations(container: HTMLElement) {
  const r = await axe.run(container, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    rules: { region: { enabled: false } },
  });
  return r.violations.map((v) => v.id);
}

describe("GoalOutlookPanel", () => {
  test("renders the three projections", () => {
    const { container } = render(
      <GoalOutlookPanel goalName="Growth Brokerage" metrics={metrics} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Growth Brokerage");
    expect(text).toContain("14.0%");
    expect(text).toContain("62.0%");
    expect(text).toContain("1.55 yrs");
  });

  test("UNKNOWN progress renders NO bar — not a bar at 0%", () => {
    const { container } = render(
      <GoalOutlookPanel goalName="Growth Brokerage" metrics={{ ...metrics, progress: null }} />,
    );
    // The projections are still there; only the bar is absent.
    expect(container.textContent).toContain("14.0%");
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  test("a real zero progress DOES render a bar — zero is a fact", () => {
    const { container } = render(
      <GoalOutlookPanel goalName="Growth Brokerage" metrics={{ ...metrics, progress: 0 }} />,
    );
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute("aria-valuenow")).toBe("0");
  });

  test("no goal at all says so, and points at where to set one", () => {
    const { container } = render(<GoalOutlookPanel goalName={null} metrics={null} />);
    const text = container.textContent ?? "";
    expect(text).toContain("No goal");
    expect(text).toContain("to set your target");
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  test("a goal with no computable metrics falls back to the same prompt", () => {
    // Objective set but the account value unknown — projections would be
    // computed against nothing.
    const { container } = render(<GoalOutlookPanel goalName="Growth Brokerage" metrics={null} />);
    const text = container.textContent ?? "";
    expect(text).toContain("Growth Brokerage");
    expect(text).toContain("to set your target");
    expect(text).not.toContain("Required CAGR");
  });

  test("no axe violations", async () => {
    const { container } = render(
      <GoalOutlookPanel goalName="Growth Brokerage" metrics={metrics} />,
    );
    expect(await violations(container)).toEqual([]);
  });
});

describe("PrioritiesPanel", () => {
  const priorities: Priority[] = [
    { id: "1", label: "Margin above the cap", severity: "critical" },
    { id: "2", label: "Rate is 45 days old", severity: "warning" },
  ];

  test("renders each priority with its severity", () => {
    const { container } = render(<PrioritiesPanel priorities={priorities} onDismiss={() => {}} />);
    const text = container.textContent ?? "";
    expect(text).toContain("Margin above the cap");
    expect(text).toContain("critical");
    expect(text).toContain("warning");
  });

  test("EMPTY says it is empty — it does not vanish", () => {
    // The opposite of the advisory strips, deliberately: a panel that
    // disappears when empty is indistinguishable from one that failed.
    const { container } = render(<PrioritiesPanel priorities={[]} onDismiss={() => {}} />);
    expect(container.innerHTML).not.toBe("");
    expect(container.textContent).toContain("Nothing flagged");
  });

  test("an unknown severity still renders rather than disappearing", () => {
    const { container } = render(
      <PrioritiesPanel
        priorities={[{ id: "3", label: "Something new", severity: "advisory" }]}
        onDismiss={() => {}}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Something new");
    expect(text).toContain("advisory");
  });

  test("dismissing passes the id, not the index", () => {
    const dismissed: string[] = [];
    const { container } = render(
      <PrioritiesPanel priorities={priorities} onDismiss={(id) => dismissed.push(id)} />,
    );
    const buttons = container.querySelectorAll("button");
    fireEvent.click(buttons[1]);
    expect(dismissed).toEqual(["2"]);
  });

  test("each dismiss button names what it dismisses", () => {
    // Six identical "Done" buttons are six unlabelled controls to a screen
    // reader (#135).
    const { container } = render(<PrioritiesPanel priorities={priorities} onDismiss={() => {}} />);
    const labels = [...container.querySelectorAll("button")].map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(labels).toEqual(["Dismiss: Margin above the cap", "Dismiss: Rate is 45 days old"]);
  });

  test("no axe violations, populated or empty", async () => {
    const populated = render(<PrioritiesPanel priorities={priorities} onDismiss={() => {}} />);
    expect(await violations(populated.container)).toEqual([]);
    const empty = render(<PrioritiesPanel priorities={[]} onDismiss={() => {}} />);
    expect(await violations(empty.container)).toEqual([]);
  });
});
