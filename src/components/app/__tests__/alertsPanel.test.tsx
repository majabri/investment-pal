// The alerts surface, and the one sentence it must never say carelessly.
//
// `alerts.test.ts` proves the rules. This proves the panel reports them — and
// above all that an empty list is never presented as an all-clear when the
// thing that would have raised the alert could not be evaluated. A surface that
// passes because it checked nothing is worse than one that fails.
import { describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import axe from "axe-core";

// The panel renders `<Link to="…">` per alert, which needs a router in scope.
// Standing one up renders asynchronously and the assertions run against an
// empty DOM, so the link becomes a plain anchor. Where it navigates is the
// router's test; what the panel SAYS is this one's.
mock.module("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const { AlertsPanel, emptyStateSentence } = await import("../AlertsPanel");
import type { AlertInput } from "@/lib/alerts";
import type { ConstitutionVerdict } from "@/lib/constitutionCheck";

const checkable: ConstitutionVerdict = { breaches: [], checkable: true, capsAreDefaults: false };
const unevaluable: ConstitutionVerdict = { breaches: [], checkable: false, capsAreDefaults: false };

const QUIET: AlertInput = {
  constitution: checkable,
  sources: [],
  positionsStaleDays: 0,
  valuationUnknown: false,
  goalProbability: 0.8,
  upcomingEvents: [],
};

describe("an empty list is not an all-clear by default", () => {
  test("nothing raised says what RAN, and what did not run here", () => {
    const { container } = render(<AlertsPanel input={QUIET} />);
    const text = container.textContent ?? "";
    expect(text).toContain("Every check on this screen ran");
    // Source health is probed in Settings. Its silence here must not read as
    // health — that is the same defect as a panel showing four sources of
    // seven and calling it complete.
    expect(text).toContain("Settings");
  });

  test("an unevaluable policy check is NEVER reported as quiet", () => {
    // The critical case. No breaches, because nothing was evaluated.
    expect(emptyStateSentence(false)).toContain("not an all-clear");
    const { container } = render(
      <AlertsPanel input={{ ...QUIET, constitution: unevaluable }} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("not a clean result");
  });

  test("a failed evaluation says so and claims nothing", () => {
    const { container } = render(<AlertsPanel input={QUIET} failed />);
    const text = container.textContent ?? "";
    expect(text).toContain("could not be evaluated");
    expect(text).toContain("Nothing here is an all-clear");
    // It must not render the quiet sentence alongside the failure.
    expect(text).not.toContain("ran and raised nothing");
  });
});

describe("what it renders when there is something", () => {
  test("NEGATIVE CONTROL: a breach appears, with its severity in words", () => {
    // Without this, every assertion above passes on a panel that renders
    // nothing at all.
    const { container } = render(
      <AlertsPanel
        input={{
          ...QUIET,
          constitution: { ...checkable, breaches: ["AAA 42% net equity > 25% cap"] },
        }}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("AAA 42%");
    // §22.2: no meaning conveyed only by colour. The word is there too.
    expect(text.toLowerCase()).toContain("critical");
  });

  test("a never-imported position is worse than a stale one, not absent", () => {
    const { container } = render(
      <AlertsPanel input={{ ...QUIET, positionsStaleDays: null }} />,
    );
    expect(container.textContent).toContain("never been imported");
  });

  test("an uncomputable goal probability raises NOTHING", () => {
    // It is not a low probability. Alerting on it would be a claim about the
    // plan that the app cannot make.
    const { container } = render(<AlertsPanel input={{ ...QUIET, goalProbability: null }} />);
    expect(container.textContent).not.toContain("Probability of reaching");
  });

  test("a low goal probability DOES raise", () => {
    const { container } = render(<AlertsPanel input={{ ...QUIET, goalProbability: 0.2 }} />);
    expect(container.textContent).toContain("Probability of reaching");
  });

  test("the types it cannot raise are named, not omitted", () => {
    // A list of seven that looks like a list of eleven is the defect this
    // whole surface exists to fix, one level up.
    const { container } = render(<AlertsPanel input={QUIET} />);
    const text = container.textContent ?? "";
    expect(text).toContain("Not raised here");
    expect(text).toContain("decision trigger");
  });
});

describe("accessibility", () => {
  test("no violations", async () => {
    const { container } = render(
      <AlertsPanel
        input={{
          ...QUIET,
          constitution: { ...checkable, breaches: ["AAA over cap"] },
          upcomingEvents: [{ date: "2026-09-15", text: "CPI" }],
        }}
      />,
    );
    const results = await axe.run(container);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
