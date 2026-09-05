// MoverList was extracted from opportunities.tsx, where it was declared inside
// the route component and so was a new component type on every render. A 200 on
// /opportunities does not prove it renders — the route is client-rendered, so
// the server HTML is just the shell. These tests are the actual evidence.
import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";

import { MoverList, type MoverRow } from "../MoverList";
import { assertNoA11yViolations } from "@/test/a11y";

const rows: MoverRow[] = [
  { sym: "AAPL", price: 231.5, changePct: 2.14 },
  { sym: "MSFT", price: 402.19, changePct: -1.03 },
];

describe("MoverList", () => {
  test("renders each row's symbol, price and signed change", () => {
    render(<MoverList title="Today's strength" items={rows} tone="up" held={new Set()} />);

    expect(screen.getByText("Today's strength")).toBeInTheDocument();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("MSFT")).toBeInTheDocument();
    // The sign is rendered separately from the magnitude, so assert the pair.
    expect(screen.getByText("+2.14%")).toBeInTheDocument();
    expect(screen.getByText("-1.03%")).toBeInTheDocument();
  });

  test("badges only the symbols that are held", () => {
    render(<MoverList title="Movers" items={rows} tone="up" held={new Set(["AAPL"])} />);

    expect(screen.getAllByText("Held")).toHaveLength(1);
  });

  test("matches a held symbol whose row form is not canonical", () => {
    // `heldSymbolSet` upper-cases what goes into the set, but the row symbols come
    // from quote keys and are not guaranteed canonical. The row must therefore be
    // normalised at lookup time too, or a lower-case row silently loses its badge —
    // the bug a previous review caught on this page.
    //
    // The row symbol here is deliberately NOT already canonical: with matching
    // cases on both sides, dropping `normaliseSymbol` from the lookup would still
    // pass and the test would assert nothing (Copilot, #134).
    const lower: MoverRow[] = [{ sym: "aapl", price: 231.5, changePct: 2.14 }];
    render(<MoverList title="Movers" items={lower} tone="up" held={new Set(["AAPL"])} />);

    expect(screen.getAllByText("Held")).toHaveLength(1);
  });

  test("renders nothing but the header when there are no rows", () => {
    render(<MoverList title="Today's weakness" items={[]} tone="down" held={new Set()} />);

    expect(screen.getByText("Today's weakness")).toBeInTheDocument();
    expect(screen.queryByText("Held")).toBeNull();
  });

  test("has no axe violations", async () => {
    const { container } = render(
      <MoverList title="Today's strength" items={rows} tone="up" held={new Set(["AAPL"])} />,
    );

    await assertNoA11yViolations(container);
  });
});
