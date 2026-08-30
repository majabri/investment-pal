// Smoke tests for the component harness (PR-UI-0): one render assertion and one
// axe assertion. StatCard is a leaf presentational component with no data or
// router dependencies, so a failure here means the harness is broken, not the app.
// The real component suite starts in a later PR.
import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";

import { StatCard } from "../StatCard";
import { assertNoA11yViolations } from "@/test/a11y";

describe("StatCard", () => {
  test("renders its label and value", () => {
    render(<StatCard label="Net value" value="$1,234.50" />);

    expect(screen.getByText("Net value")).toBeInTheDocument();
    expect(screen.getByText("$1,234.50")).toBeInTheDocument();
  });

  test("has no axe violations", async () => {
    const { container } = render(
      <StatCard label="Net value" value="$1,234.50" hint="as of today" />,
    );

    await assertNoA11yViolations(container);
  });
});
