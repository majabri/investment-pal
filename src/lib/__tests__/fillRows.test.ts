// The boundary between a `fills` row and a `Fill` — the same guard
// `trancheRows.test.ts` proves, for `source` rather than `kind`.
import { describe, expect, test } from "bun:test";

import type { Row } from "@/lib/dbRows";
import {
  fillFromRow,
  fillsOf,
  isFillSource,
  readFills,
  unreadableFillsNote,
} from "@/lib/fillRows";

const row = (over: Partial<Row<"fills">> = {}): Row<"fills"> => ({
  id: "f1",
  user_id: "u1",
  order_id: "o1",
  filled_at: "2026-03-01T14:30:00Z",
  quantity: 10,
  price: 100,
  fees: null,
  source: "imported",
  broker_ref: null,
  note: null,
  created_at: "2026-03-01T14:30:05Z",
  ...over,
});

describe("isFillSource", () => {
  test("NEGATIVE CONTROL: the three sources the schema permits are accepted", () => {
    expect(isFillSource("imported")).toBe(true);
    expect(isFillSource("user_entry")).toBe(true);
    expect(isFillSource("derived")).toBe(true);
  });

  test("anything else is refused — including the AI value rule 18 forbids", () => {
    expect(isFillSource("ai")).toBe(false);
    expect(isFillSource("model")).toBe(false);
    expect(isFillSource("")).toBe(false);
    expect(isFillSource("Imported")).toBe(false);
  });
});

describe("fillFromRow", () => {
  test("NEGATIVE CONTROL: a well-formed row reads through", () => {
    const f = fillFromRow(row());
    expect(f).not.toBeNull();
    expect(f!.order_id).toBe("o1");
    expect(f!.quantity).toBe(10);
    expect(f!.source).toBe("imported");
  });

  test("an unrecognised source yields NULL, not a default", () => {
    expect(fillFromRow(row({ source: "ai" }))).toBeNull();
  });

  test("NULL fees stay NULL — not known is not free", () => {
    const f = fillFromRow(row({ fees: null }))!;
    expect(f.fees).toBeNull();
    expect("fees" in f).toBe(true);
  });

  test("storage columns do not leak into the domain type", () => {
    const f = fillFromRow(row({ note: "x" })) as unknown as Record<string, unknown>;
    expect("note" in f).toBe(false);
    expect("user_id" in f).toBe(false);
    expect("created_at" in f).toBe(false);
  });
});

describe("readFills", () => {
  test("NEGATIVE CONTROL: clean rows all read, grouped by order, nothing unreadable", () => {
    const read = readFills([
      row({ id: "a", order_id: "o1" }),
      row({ id: "b", order_id: "o2" }),
      row({ id: "c", order_id: "o1" }),
    ]);
    expect(read.total).toBe(3);
    expect(read.unreadable).toBe(0);
    expect(fillsOf(read, "o1").map((f) => f.id)).toEqual(["a", "c"]);
    expect(fillsOf(read, "o2").map((f) => f.id)).toEqual(["b"]);
  });

  test("a bad row is COUNTED, not silently dropped", () => {
    // A list one fill short reconciles as `under` against the order and looks
    // exactly like an order that is still filling. The count is the only tell.
    const read = readFills([row({ id: "a" }), row({ id: "bad", source: "ai" })]);
    expect(fillsOf(read, "o1").map((f) => f.id)).toEqual(["a"]);
    expect(read.unreadable).toBe(1);
    expect(read.total).toBe(1);
  });

  test("each order's fills come back oldest first — the order the partials happened in", () => {
    const read = readFills([
      row({ id: "later", filled_at: "2026-03-01T15:00:00Z" }),
      row({ id: "earlier", filled_at: "2026-03-01T14:00:00Z" }),
    ]);
    expect(fillsOf(read, "o1").map((f) => f.id)).toEqual(["earlier", "later"]);
  });

  test("an order with no fills reads as EMPTY, not as missing", () => {
    const read = readFills([row({ order_id: "o1" })]);
    expect(fillsOf(read, "o-none")).toEqual([]);
  });

  test("all rows unreadable is not the same as no rows", () => {
    expect(readFills([row({ source: "x" })]).unreadable).toBe(1);
    expect(readFills([]).unreadable).toBe(0);
  });
});

describe("unreadableFillsNote", () => {
  test("NEGATIVE CONTROL: a clean read gets NO note", () => {
    expect(unreadableFillsNote(readFills([row()]))).toBeNull();
  });

  test("it says the direction of the error", () => {
    const note = unreadableFillsNote(readFills([row({ source: "x" }), row({ source: "y" })]))!;
    expect(note).toContain("2 fills");
    expect(note).toContain("fewer fills than were recorded");
  });

  test("singular reads correctly", () => {
    const note = unreadableFillsNote(readFills([row({ source: "x" })]))!;
    expect(note).toContain("1 fill ");
    expect(note).toContain(" is not counted");
  });
});
