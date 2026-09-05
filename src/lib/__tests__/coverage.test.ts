// Phase 5, rule 30: a financial-data failure capable of changing a decision
// must fail visibly.
//
// "'Account equity: Unavailable', never $0. 'Open-order status unavailable',
// never 'No open orders'. 'Economic-event coverage unavailable', never
// 'No events.'"
//
// The third was live on four screens, all written the same way:
//
//     const { data: events = [], isLoading } = useQuery(...)
//     {!isLoading && events.length === 0 && <p>No earnings…</p>}
//
// React Query settles `isLoading` to false when a query FAILS, and the `= []`
// default fills in for the missing data. So a fetch that errored rendered
// "No earnings for these names in the next 14 days" — which is a reason to
// hold through the week — and "Nothing market-relevant right now."
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { coverageNotice, coverageOf, coveragePromptLines } from "../coverage";

describe("coverageOf", () => {
  test("loading is loading", () => {
    expect(coverageOf({ isLoading: true, data: undefined })).toBe("LOADING");
  });

  test("an error is UNAVAILABLE, not empty", () => {
    // The defect in one line. `isLoading` is false here, and every one of the
    // four screens rendered its empty state.
    expect(coverageOf({ isLoading: false, isError: true, data: [] })).toBe("UNAVAILABLE");
  });

  test("settled with no data is UNAVAILABLE", () => {
    // `isError` alone is not enough: a query can settle with `data` undefined
    // — disabled, cancelled, or resolved to nothing by a server function that
    // swallowed its own error — and the caller's `= []` default then makes
    // that indistinguishable from an empty result.
    expect(coverageOf({ isLoading: false, isError: false, data: undefined })).toBe("UNAVAILABLE");
    expect(coverageOf({ isLoading: false, data: null })).toBe("UNAVAILABLE");
  });

  test("an empty array that was actually fetched is AVAILABLE", () => {
    // The case that must NOT be swept up: the source was read and returned
    // nothing. That is a real answer.
    expect(coverageOf({ isLoading: false, isError: false, data: [] })).toBe("AVAILABLE");
  });

  test("NEGATIVE CONTROL: a successful fetch with rows is AVAILABLE", () => {
    // Without this, `coverageOf = () => "UNAVAILABLE"` would pass everything
    // above except the loading case.
    expect(coverageOf({ isLoading: false, isError: false, data: [1, 2] })).toBe("AVAILABLE");
  });
});

describe("coverageNotice", () => {
  const notice = (c: Parameters<typeof coverageNotice>[1], n: number) =>
    coverageNotice("economic events", c, n, "No events in the next 10 days.");

  test("unavailable says what it is NOT", () => {
    // The middle clause is the one that matters. Without it a user reads
    // "unavailable" as "none" anyway.
    const out = notice("UNAVAILABLE", 0)!;
    expect(out).toContain("unavailable");
    expect(out).toContain("not the same as there being none");
  });

  test("unavailable never prints the empty message", () => {
    expect(notice("UNAVAILABLE", 0)).not.toContain("No events in the next 10 days.");
  });

  test("an honestly empty result gets the caller's own wording", () => {
    // No default is provided by the module: only the caller knows what an
    // empty result means on that screen, and a generic "nothing found" is the
    // sentence this exists to stop being printed over a failure.
    expect(notice("AVAILABLE", 0)).toBe("No events in the next 10 days.");
  });

  test("a non-empty available result needs no notice", () => {
    expect(notice("AVAILABLE", 3)).toBeNull();
  });

  test("loading is loading, and says so", () => {
    expect(notice("LOADING", 0)).toContain("Loading");
  });

  test("NEGATIVE CONTROL: the four states give four different answers", () => {
    const answers = [
      notice("LOADING", 0),
      notice("UNAVAILABLE", 0),
      notice("AVAILABLE", 0),
      notice("AVAILABLE", 3),
    ];
    expect(new Set(answers.map(String)).size).toBe(4);
  });
});

describe("coveragePromptLines", () => {
  test("unavailable tells the model not to read it as an empty list", () => {
    // A model reads "- (none)" as a fact and reasons from it: no catalysts
    // this week, therefore nothing to wait for.
    const out = coveragePromptLines("news", "UNAVAILABLE", []);
    expect(out).toContain("NOT KNOWN");
    expect(out).toContain("Do not conclude there are none");
  });

  test("an empty result says the source WAS read", () => {
    const out = coveragePromptLines("news", "AVAILABLE", []);
    expect(out).toContain("the source was read");
  });

  test("rows are listed", () => {
    expect(coveragePromptLines("news", "AVAILABLE", ["A (X)", "B (Y)"])).toBe("- A (X)\n- B (Y)");
  });

  test("NEGATIVE CONTROL: unavailable and empty are different text", () => {
    // They were the same string — `- (none)` — which is the whole defect.
    expect(coveragePromptLines("news", "UNAVAILABLE", [])).not.toBe(
      coveragePromptLines("news", "AVAILABLE", []),
    );
  });
});

// The module only helps where it is used. This is the half that says it is.
describe("the screens that had this defect now use the module", () => {
  const SCREENS = [
    "src/routes/_authenticated/economic-calendar.tsx",
    "src/routes/_authenticated/geopolitics.tsx",
    "src/routes/_authenticated/earnings.tsx",
    "src/routes/_authenticated/news.tsx",
  ];

  test("each reads coverage from the query", () => {
    for (const f of SCREENS) {
      expect(readFileSync(f, "utf8")).toContain("coverageOf(");
    }
  });

  test("none still destructures a defaulted array straight out of useQuery", () => {
    // `const { data: x = [] } = useQuery(...)` is the exact shape of the
    // defect: it throws away `isError` and papers over undefined data.
    const DEFAULTED = /const\s*\{[^}]*\bdata\s*:\s*\w+\s*=\s*\[\][^}]*\}\s*=\s*useQuery/;
    for (const f of SCREENS) {
      expect(DEFAULTED.test(readFileSync(f, "utf8"))).toBe(false);
    }
  });

  test("NEGATIVE CONTROL: that pattern matches the shape it forbids", () => {
    const DEFAULTED = /const\s*\{[^}]*\bdata\s*:\s*\w+\s*=\s*\[\][^}]*\}\s*=\s*useQuery/;
    expect(DEFAULTED.test(`const { data: events = [], isLoading } = useQuery({})`)).toBe(true);
    // And spares the safe shape, which several of these files still use for
    // queries whose emptiness is not a claim about the world.
    expect(DEFAULTED.test(`const query = useQuery({}); const events = query.data ?? [];`)).toBe(
      false,
    );
  });
});
