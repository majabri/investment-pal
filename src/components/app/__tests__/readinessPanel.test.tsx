// The state that used to be invisible.
//
// The panel asked `gate()` for allowed/blocked and returned NULL when allowed —
// so a review running WITHOUT a noncritical input rendered nothing at all. The
// blueprint singles that case out (§23.2): "a review may still run in degraded
// mode, but the output must clearly state what is unavailable and which
// conclusions are blocked." Silence is not that statement.
//
// `readinessGate.test.ts` proves the four states. This proves the screen shows
// them — and specifically that DEGRADED is no longer nothing.
import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import axe from "axe-core";

import { ReadinessPanel } from "../ReadinessPanel";
import type { ReadinessCheck } from "@/lib/readiness";

/** A check in whichever state the case needs. Real ids, so the gate matches. */
const check = (
  id: ReadinessCheck["id"],
  state: ReadinessCheck["state"],
  label: string,
): ReadinessCheck => ({ id, state, label, detail: `${label} detail` });

/** Everything a committee brief depends on, all passing. */
const ALL_PASS: ReadinessCheck[] = [
  check("reconciliation", "pass", "Reconciliation"),
  check("positions", "pass", "Positions"),
  check("quotes", "pass", "Quotes"),
  check("cash", "pass", "Cash"),
  check("margin", "pass", "Margin"),
  check("open_orders", "pass", "Open orders"),
  check("policy", "pass", "Policy"),
];

const renderPanel = (checks: ReadinessCheck[]) =>
  render(<ReadinessPanel checks={checks} capability="committee_recommendation" what="this brief" />);

describe("READY is the only silent state", () => {
  test("everything passing renders nothing", () => {
    const { container } = renderPanel(ALL_PASS);
    expect(container.innerHTML).toBe("");
  });
});

describe("DEGRADED says what is missing instead of saying nothing", () => {
  // Open orders is NONCRITICAL to a committee brief — prose a human reads —
  // and critical to position sizing. Before this, the brief case rendered
  // nothing at all.
  const degraded = ALL_PASS.map((c) =>
    c.id === "open_orders" ? check("open_orders", "unknown", "Open orders") : c,
  );

  test("it renders at all — the whole point", () => {
    const { container } = renderPanel(degraded);
    expect(container.innerHTML).not.toBe("");
  });

  test("it says the brief is being produced, not refused", () => {
    const { container } = renderPanel(degraded);
    const text = container.textContent ?? "";
    expect(text).toContain("with gaps");
    expect(text).not.toContain("Not ready to produce");
  });

  test("it names the gap and what is not concluded from it", () => {
    const { container } = renderPanel(degraded);
    const text = container.textContent ?? "";
    expect(text).toContain("Produced without open orders");
    expect(text).toContain("are not drawn here");
  });

  test("the state is in words, not only in colour", () => {
    // §22.2: no meaning conveyed only by colour.
    expect(renderPanel(degraded).container.textContent).toContain("DEGRADED");
  });
});

describe("BLOCKED still refuses, and says which input", () => {
  const blocked = ALL_PASS.map((c) =>
    c.id === "positions" ? check("positions", "fail", "Positions") : c,
  );

  test("it refuses in words", () => {
    const text = renderPanel(blocked).container.textContent ?? "";
    expect(text).toContain("Not ready to produce");
    expect(text).toContain("BLOCKED");
  });

  test("it names the blocking input and prohibits the conclusions", () => {
    const text = renderPanel(blocked).container.textContent ?? "";
    expect(text).toContain("Positions");
    expect(text).toContain("prohibited");
  });

  test("it still names what IS passing", () => {
    // A panel that reads as "everything is broken" is both wrong and the
    // reason people stop reading these.
    const text = renderPanel(blocked).container.textContent ?? "";
    expect(text).toContain("Passing:");
    expect(text).toContain("Quotes");
  });

  test("a critical failure outranks a noncritical gap", () => {
    const both = ALL_PASS.map((c) =>
      c.id === "positions"
        ? check("positions", "fail", "Positions")
        : c.id === "open_orders"
          ? check("open_orders", "unknown", "Open orders")
          : c,
    );
    const text = renderPanel(both).container.textContent ?? "";
    expect(text).toContain("BLOCKED");
    expect(text).not.toContain("DEGRADED");
  });
});

describe("accessibility", () => {
  test("no violations in either visible state", async () => {
    for (const checks of [
      ALL_PASS.map((c) => (c.id === "open_orders" ? check("open_orders", "unknown", "Open orders") : c)),
      ALL_PASS.map((c) => (c.id === "positions" ? check("positions", "fail", "Positions") : c)),
    ]) {
      const { container } = renderPanel(checks);
      const results = await axe.run(container);
      expect(results.violations.map((v) => v.id)).toEqual([]);
    }
  });
});
