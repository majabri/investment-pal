// The governance strip's three states must stay distinct (audit brief G4).
//
// `constitutionCheck.test.ts` proves the arithmetic. This proves the strip says
// the right thing about it — and above all that it never claims "clean" when it
// could not evaluate a single limit. A governance surface that passes because
// it checked nothing is worse than one that fails.
import { describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import axe from "axe-core";

// The strip renders `<Link to="/settings">`, which needs a router in scope.
// Standing one up renders asynchronously and the assertions run against an
// empty DOM — so the link becomes a plain anchor instead. The strip's job is
// what it SAYS, not where the link goes; routing is the router's test.
mock.module("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const { CommandCenterStrip } = await import("../CommandCenterStrip");
import type { ConstitutionVerdict } from "@/lib/constitutionCheck";
import type { InterestFigure, RateStatus } from "@/lib/marginCost";

const renderStrip = render;

const clean: ConstitutionVerdict = { breaches: [], checkable: true, capsAreDefaults: false };
// Real shapes, not casts. A cast here would let a fixture drift out of the
// union the component actually receives and still compile.
const noInterest: InterestFigure = { kind: "unavailable", reason: "no-import" };
const rateOk: RateStatus = { kind: "current", asOf: "2026-09-01", ageDays: 9 };

const base = {
  verdict: clean,
  equityPct: 0.7,
  marginUsed: 0,
  interest: noInterest,
  rateState: rateOk,
  staleDays: 0,
  noScope: false,
  scopeName: "Individual — TOD",
};

describe("the constitution line", () => {
  test("clean when it was actually checked and nothing breached", () => {
    const { container } = renderStrip(<CommandCenterStrip {...base} />);
    expect(container.textContent).toContain("Constitution: clean");
  });

  test("UNCHECKED is never rendered as clean — the whole point", () => {
    const { container } = renderStrip(
      <CommandCenterStrip
        {...base}
        verdict={{ breaches: [], checkable: false, capsAreDefaults: false }}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("not checked");
    expect(text).toContain("account value unknown");
    expect(text).not.toContain("Constitution: clean");
  });

  test("no resolved scope says which scope, and evaluates nothing", () => {
    const { container } = renderStrip(
      <CommandCenterStrip {...base} noScope scopeName="No account selected" />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("no account selected");
    expect(text).not.toContain("clean");
    expect(text).not.toContain("not checked");
  });

  test("breaches are listed, all of them", () => {
    const { container } = renderStrip(
      <CommandCenterStrip
        {...base}
        verdict={{
          breaches: [
            "NVDA 34.3% of net equity > 30% cap",
            "Margin util 42.9% of net equity > 25% cap",
          ],
          checkable: true,
          capsAreDefaults: false,
        }}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("NVDA 34.3% of net equity");
    expect(text).toContain("Margin util 42.9%");
    expect(text).not.toContain("clean");
  });
});

describe("the freshness line", () => {
  test("never imported is not 'imported today'", () => {
    const { container } = renderStrip(<CommandCenterStrip {...base} staleDays={null} />);
    const text = container.textContent ?? "";
    expect(text).toContain("never imported");
    expect(text).not.toContain("imported today");
    // And it offers the way out.
    expect(text).toContain("Import now");
  });

  test("today is fresh and offers no prompt", () => {
    const { container } = renderStrip(<CommandCenterStrip {...base} staleDays={0} />);
    expect(container.textContent).toContain("imported today");
    expect(container.textContent).not.toContain("Import now");
  });

  test("stale days are named", () => {
    const { container } = renderStrip(<CommandCenterStrip {...base} staleDays={3} />);
    expect(container.textContent).toContain("imported 3d ago");
  });
});

describe("the margin line", () => {
  test("an unknown debit says so — it is not zero", () => {
    const { container } = renderStrip(<CommandCenterStrip {...base} marginUsed={null} />);
    const text = container.textContent ?? "";
    expect(text).toContain("Margin not known");
    expect(text).not.toContain("not set");
  });

  test("a real zero says 'not set', which is a different fact", () => {
    const { container } = renderStrip(<CommandCenterStrip {...base} marginUsed={0} />);
    expect(container.textContent).toContain("not set");
  });

  test("an unknown equity renders Unavailable, not 0%", () => {
    const { container } = renderStrip(
      <CommandCenterStrip
        {...base}
        marginUsed={30_000}
        equityPct={null}
        interest={{ kind: "estimate", daily: 4.11, annual: 1500 }}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Unavailable");
    expect(text).not.toContain("equity 0.0%");
  });

  test("a stale margin rate is flagged only when there is a balance", () => {
    const stale: RateStatus = { kind: "stale", asOf: "2026-07-27", ageDays: 45 };
    const withBalance = renderStrip(
      <CommandCenterStrip {...base} marginUsed={30_000} rateState={stale} />,
    );
    expect(withBalance.container.textContent).toContain("Margin rate 45d old");

    const noBalance = renderStrip(
      <CommandCenterStrip {...base} marginUsed={0} rateState={stale} />,
    );
    expect(noBalance.container.textContent).not.toContain("Margin rate 45d old");
  });
});

describe("accessibility", () => {
  test("no axe violations in the breach state", async () => {
    const { container } = renderStrip(
      <CommandCenterStrip
        {...base}
        verdict={{
          breaches: ["NVDA 34.3% of net equity > 30% cap"],
          checkable: true,
          capsAreDefaults: false,
        }}
        staleDays={null}
      />,
    );
    const r = await axe.run(container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
      rules: { region: { enabled: false } },
    });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});
