// The boundary between a `tranches` row and a `Tranche`.
//
// The generated types widen `kind` to `string` — Postgres constrains it with a
// CHECK, but PostgREST reports the column's type, not its constraint. The cast
// `useLots` uses would hand a row carrying any string a compile-time type
// claiming it is `"core" | "tactical"`.
import { describe, expect, test } from "bun:test";

import type { Row } from "@/lib/dbRows";
import {
  isTrancheKind,
  readTranches,
  trancheFromRow,
  unreadableNote,
} from "@/lib/trancheRows";

const row = (over: Partial<Row<"tranches">> = {}): Row<"tranches"> => ({
  id: "t1",
  user_id: "u1",
  account_id: "acct-1",
  symbol: "AAA",
  security_id: null,
  kind: "core",
  decision_id: null,
  opened_at: "2026-01-15T00:00:00Z",
  closed_at: null,
  opened_quantity: 50,
  target: null,
  invalidation: null,
  note: null,
  created_at: "2026-01-15T00:00:00Z",
  updated_at: "2026-01-15T00:00:00Z",
  ...over,
});

describe("isTrancheKind", () => {
  test("NEGATIVE CONTROL: the two kinds the schema permits are accepted", () => {
    // Without this, every assertion below passes on a predicate returning false
    // for everything.
    expect(isTrancheKind("core")).toBe(true);
    expect(isTrancheKind("tactical")).toBe(true);
  });

  test("anything else is refused", () => {
    expect(isTrancheKind("hedge")).toBe(false);
    expect(isTrancheKind("")).toBe(false);
    // Case matters: the CHECK is case-sensitive, so the parser must be too.
    expect(isTrancheKind("Core")).toBe(false);
    expect(isTrancheKind("CORE")).toBe(false);
  });
});

describe("trancheFromRow", () => {
  test("NEGATIVE CONTROL: a well-formed row reads through", () => {
    const t = trancheFromRow(row());
    expect(t).not.toBeNull();
    expect(t!.kind).toBe("core");
    expect(t!.opened_quantity).toBe(50);
    expect(t!.symbol).toBe("AAA");
  });

  test("an unrecognised kind yields NULL rather than a coerced default", () => {
    // The whole point. Defaulting to "core" would invent a classification, and
    // the position would appear in the core total as though somebody had said
    // it belonged there.
    expect(trancheFromRow(row({ kind: "hedge" }))).toBeNull();
  });

  test("it carries the nullable fields through as NULL, not as absent", () => {
    const t = trancheFromRow(row({ security_id: null, decision_id: null, target: null }));
    expect(t!.security_id).toBeNull();
    expect(t!.decision_id).toBeNull();
    expect(t!.target).toBeNull();
    // Present-and-null is a different claim from missing, and `aggregationNote`
    // and the exit logic both read these.
    expect("security_id" in t!).toBe(true);
    expect("target" in t!).toBe(true);
  });

  test("it does not carry columns the domain type does not model", () => {
    // `note`, `user_id` and the timestamps are storage concerns. Leaking them
    // into `Tranche` would make the domain type a mirror of the table, and the
    // next schema change would ripple into every consumer.
    const t = trancheFromRow(row({ note: "a note" })) as unknown as Record<string, unknown>;
    expect("note" in t).toBe(false);
    expect("user_id" in t).toBe(false);
    expect("updated_at" in t).toBe(false);
  });
});

describe("readTranches", () => {
  test("NEGATIVE CONTROL: clean rows all read, and nothing is reported unreadable", () => {
    const read = readTranches([row({ id: "a" }), row({ id: "b", kind: "tactical" })]);
    expect(read.tranches.map((t) => t.id)).toEqual(["a", "b"]);
    expect(read.unreadable).toBe(0);
  });

  test("a bad row is COUNTED, not silently dropped", () => {
    // Dropping it would make the list shorter and identical in shape to a
    // correct one. The count is the only thing that distinguishes "the account
    // holds two tranches" from "the account holds three and I can read two".
    const read = readTranches([row({ id: "a" }), row({ id: "bad", kind: "hedge" })]);
    expect(read.tranches.map((t) => t.id)).toEqual(["a"]);
    expect(read.unreadable).toBe(1);
  });

  test("every row being unreadable is not the same as no rows", () => {
    const allBad = readTranches([row({ kind: "x" }), row({ kind: "y" })]);
    const none = readTranches([]);
    expect(allBad.tranches).toEqual([]);
    expect(none.tranches).toEqual([]);
    // Identical lists, different truths — which is exactly why the count exists.
    expect(allBad.unreadable).toBe(2);
    expect(none.unreadable).toBe(0);
  });

  test("an empty table reads as empty, not as an error", () => {
    expect(readTranches([])).toEqual({ tranches: [], unreadable: 0 });
  });
});

describe("unreadableNote", () => {
  test("NEGATIVE CONTROL: a clean read gets NO note", () => {
    expect(unreadableNote({ tranches: [], unreadable: 0 })).toBeNull();
  });

  test("it says the totals are understated, not merely that something is wrong", () => {
    // "Something went wrong" leaves the reader trusting the number on screen.
    // The direction of the error is the actionable part.
    const note = unreadableNote({ tranches: [], unreadable: 2 })!;
    expect(note).toContain("2 tranches");
    expect(note).toContain("lower than the account holds");
  });

  test("it reads correctly for a single row", () => {
    const note = unreadableNote({ tranches: [], unreadable: 1 })!;
    expect(note).toContain("1 tranche ");
    expect(note).not.toContain("1 tranches");
    expect(note).toContain(" is not counted");
  });
});
