// Smoke test 2 (component render): SwingScoreBadge is a pure leaf (props only,
// no providers/hooks), so it exercises the jsdom + testing-library path cleanly.
// Located in tests/ to keep zero diff in src/components/.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SwingScoreBadge } from "@/components/app/SwingScoreBadge";
import type { SwingResult } from "@/lib/swingScore";

describe("SwingScoreBadge", () => {
  it("renders the score for a scored result", () => {
    const r: SwingResult = {
      insufficient: false,
      score: 72,
      band: "trim-partial",
      suggestion: "Consider trim 10–25%",
      rsi: 68,
      pctAbove20: 5,
      pctAbove50: 12,
    };
    const { container } = render(<SwingScoreBadge r={r} />);
    expect(container.textContent).toContain("72");
  });

  it("renders an em dash when history is insufficient", () => {
    const r: SwingResult = { insufficient: true, band: "none", suggestion: null };
    const { container } = render(<SwingScoreBadge r={r} />);
    expect(container.textContent).toContain("—");
  });
});
