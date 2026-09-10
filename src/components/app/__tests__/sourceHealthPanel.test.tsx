// The panel must not say "all good" while something is failing (OBS-001).
import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import axe from "axe-core";

import { SourceHealthPanel } from "../SourceHealthPanel";
import { SOURCES } from "@/lib/sourceHealth";
import type { SourceHealth } from "@/lib/sourceHealth";
import type { Coverage } from "@/lib/coverage";

const entry = (i: number, coverage: Coverage): SourceHealth => ({
  descriptor: SOURCES[i],
  coverage,
  lastOkAt: null,
});

describe("SourceHealthPanel", () => {
  test("lists every source with its provider", () => {
    const { container } = render(
      <SourceHealthPanel entries={SOURCES.map((_, i) => entry(i, "AVAILABLE"))} />,
    );
    const text = container.textContent ?? "";
    for (const s of SOURCES) {
      expect(text).toContain(s.label);
      expect(text).toContain(s.provider);
    }
  });

  test("a failing source shows WHAT BREAKS; a working one does not", () => {
    const { container } = render(
      <SourceHealthPanel entries={[entry(3, "UNAVAILABLE"), entry(0, "AVAILABLE")]} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain(SOURCES[3].impact);
    expect(text).not.toContain(SOURCES[0].impact);
  });

  test("one failure never reads as all good", () => {
    const { container } = render(
      <SourceHealthPanel entries={[entry(0, "AVAILABLE"), entry(3, "UNAVAILABLE")]} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("did not answer");
    expect(text).not.toContain("All 2 data sources answered");
  });

  test("a failing source says 'did not answer', never 'none'", () => {
    // Rule 30 in one line: unavailable is UNKNOWN, not an empty result.
    //
    // Asserted on the STATE label rather than the whole panel: the news
    // source's impact line quotes the phrase "no news" precisely to say what
    // the app must not conclude, and a substring scan over everything cannot
    // tell a warning against a wording from the wording itself.
    const { container } = render(<SourceHealthPanel entries={[entry(5, "UNAVAILABLE")]} />);
    const states = [...container.querySelectorAll("li span")].map((e) => e.textContent);
    expect(states).toContain("did not answer");
    expect(states.join(" ").toLowerCase()).not.toContain("none");
  });

  test("loading claims nothing either way", () => {
    const { container } = render(<SourceHealthPanel entries={[entry(0, "LOADING")]} />);
    const text = container.textContent ?? "";
    expect(text).toContain("Checking");
    expect(text).not.toContain("answered.");
    expect(text).not.toContain("did not answer");
  });

  test("it says the history is not recorded, rather than implying it is", () => {
    const { container } = render(<SourceHealthPanel entries={[entry(0, "AVAILABLE")]} />);
    expect(container.textContent).toContain("no history is recorded yet");
  });

  test("the banner is a live region, so a change is announced", () => {
    const { container } = render(<SourceHealthPanel entries={[entry(0, "AVAILABLE")]} />);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  test("sources it cannot check are NAMED, not omitted", () => {
    // Four of seven shown as though four were all is the same defect the panel
    // exists to fix, one level up: a complete-looking list that is partial.
    const { container } = render(
      <SourceHealthPanel
        entries={[entry(0, "AVAILABLE")]}
        unprobed={[{ descriptor: SOURCES[3], reason: "needs a symbol list" }]}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Not checked here");
    expect(text).toContain(SOURCES[3].label);
    expect(text).toContain("needs a symbol list");
  });

  test("nothing unprobed renders no such block", () => {
    const { container } = render(<SourceHealthPanel entries={[entry(0, "AVAILABLE")]} />);
    expect(container.textContent).not.toContain("Not checked here");
  });

  test("an unprobed source does NOT count toward the summary", () => {
    // Counting it as ok would claim it answered; counting it as failing would
    // claim it did not. It was not asked.
    const { container } = render(
      <SourceHealthPanel
        entries={[entry(0, "AVAILABLE")]}
        unprobed={[{ descriptor: SOURCES[3], reason: "needs a symbol list" }]}
      />,
    );
    expect(container.textContent).toContain("All 1 data sources answered");
  });

  test("no axe violations, healthy or degraded", async () => {
    const check = async (entries: SourceHealth[]) => {
      const { container } = render(<SourceHealthPanel entries={entries} />);
      const r = await axe.run(container, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
        rules: { region: { enabled: false } },
      });
      return r.violations.map((v) => v.id);
    };
    expect(await check([entry(0, "AVAILABLE")])).toEqual([]);
    expect(await check([entry(0, "AVAILABLE"), entry(3, "UNAVAILABLE")])).toEqual([]);
  });
});
