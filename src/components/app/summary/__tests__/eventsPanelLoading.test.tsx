// A panel must not answer a question it has not yet asked (audit brief G4).
//
// `EventsPanel` has always had a loading branch. The DASHBOARD passed
// `isLoading={false}` as a literal, so while the earnings query was in flight —
// with `liveEarn` defaulting to `[]` — the panel rendered
//
//     "Nothing you hold reports in the next 30 days."
//
// That is a claim about the earnings calendar made before the calendar had been
// read. `/summary` always passed the real flag; the dashboard did not.
//
// This is the load-window shape the brief names as Task 6's reason for
// existing: something rendering before its data resolved, in a component with
// eighteen independent loading states.
import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";

import { EventsPanel } from "../SummaryPanels";

const earnings = [{ symbol: "NVDA", date: "2026-09-20", session: "amc" }];

describe("EventsPanel loading state", () => {
  test("LOADING says so, and asserts nothing about the calendar", () => {
    const { container } = render(<EventsPanel earnings={[]} isLoading heldCount={4} />);
    const text = container.textContent ?? "";
    expect(text).toContain("Loading the earnings calendar");
    // The three claims it must NOT make while loading.
    expect(text).not.toContain("Nothing you hold reports");
    expect(text).not.toContain("No positions in this account");
    expect(text).not.toContain("NVDA");
  });

  test("loading takes precedence over an empty result", () => {
    // The exact combination the dashboard produced: in flight, data defaulted
    // to []. If empty won, the panel would answer before it knew.
    const { container } = render(<EventsPanel earnings={[]} isLoading heldCount={4} />);
    expect(container.textContent).toContain("Loading");
  });

  test("loading takes precedence over a zero held count too", () => {
    const { container } = render(<EventsPanel earnings={[]} isLoading heldCount={0} />);
    expect(container.textContent).toContain("Loading");
  });

  test("LOADED and empty is a real answer, and gives it", () => {
    const { container } = render(<EventsPanel earnings={[]} isLoading={false} heldCount={4} />);
    const text = container.textContent ?? "";
    expect(text).toContain("Nothing you hold reports in the next 30 days");
    expect(text).not.toContain("Loading");
  });

  test("LOADED with no positions says that instead — a different fact", () => {
    const { container } = render(<EventsPanel earnings={[]} isLoading={false} heldCount={0} />);
    const text = container.textContent ?? "";
    expect(text).toContain("No positions in this account");
    expect(text).not.toContain("Nothing you hold reports");
  });

  test("LOADED with events lists them", () => {
    const { container } = render(
      <EventsPanel earnings={earnings} isLoading={false} heldCount={4} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("NVDA");
    expect(text).toContain("after close");
  });

  test("the dashboard passes a real flag, not a literal false", () => {
    // The defect was at the CALL SITE, so the call site is what this pins.
    // A component test alone would have stayed green through the whole bug.
    const route = require("node:fs").readFileSync(
      "src/routes/_authenticated/index.tsx",
      "utf8",
    ) as string;
    expect(route).toContain("isLoading={earningsLoading}");
    expect(route).not.toContain("isLoading={false}");
  });
});
