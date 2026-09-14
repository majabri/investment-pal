// A fill as typed, and the row it becomes (§12.3, §26.2).
//
// The property worth most here is the last describe: this validator and
// `fillRejection` agree on every draft. Two validators that can disagree is
// how a form accepts what the mutation refuses, or refuses what it would
// have accepted.
import { describe, expect, test } from "bun:test";

import {
  candidateOf,
  canRecordFill,
  emptyFillDraft,
  fillInsert,
  isFutureLocalMinute,
  isRealLocalMinute,
  localIsoMinute,
  validateFillDraft,
} from "@/lib/fillDraft";
import type { FillDraft } from "@/lib/fillDraft";
import { fillRejection } from "@/lib/fills";
import type { Fill } from "@/lib/fills";

// A fixed "now", so nothing here depends on the clock.
const NOW = new Date(2026, 8, 14, 15, 30); // 2026-09-14 15:30 local
const PAST = "2026-09-14T09:00";

const draft = (over: Partial<FillDraft> = {}): FillDraft => ({
  filledAt: PAST,
  quantity: 10,
  price: 100,
  fees: null,
  brokerRef: null,
  note: null,
  ...over,
});

const fill = (over: Partial<Fill> = {}): Fill => ({
  id: "f1",
  order_id: "o1",
  filled_at: "2026-09-14T13:00:00Z",
  quantity: 5,
  price: 99,
  fees: null,
  source: "imported",
  broker_ref: "ABC-1",
  ...over,
});

const messages = (d: FillDraft, existing: Fill[] = []) =>
  validateFillDraft(d, existing, NOW).map((p) => p.field);

describe("localIsoMinute / isRealLocalMinute", () => {
  test("NEGATIVE CONTROL: now formats and round-trips", () => {
    const v = localIsoMinute(NOW);
    expect(v).toBe("2026-09-14T15:30");
    expect(isRealLocalMinute(v)).toBe(true);
  });

  test("the shape alone is not enough — 31 February rolls forward and is refused", () => {
    expect(isRealLocalMinute("2026-02-31T10:00")).toBe(false);
    expect(isRealLocalMinute("2026-04-31T10:00")).toBe(false);
  });

  test("a date without a time is not a fill time", () => {
    expect(isRealLocalMinute("2026-09-14")).toBe(false);
  });

  test("seconds are not accepted — the input is to the minute", () => {
    expect(isRealLocalMinute("2026-09-14T09:00:00")).toBe(false);
  });
});

describe("isFutureLocalMinute", () => {
  test("later than now is future; now and earlier are not", () => {
    expect(isFutureLocalMinute("2026-09-14T15:31", NOW)).toBe(true);
    expect(isFutureLocalMinute("2026-09-14T15:30", NOW)).toBe(false);
    expect(isFutureLocalMinute(PAST, NOW)).toBe(false);
  });
});

describe("validateFillDraft", () => {
  test("NEGATIVE CONTROL: a complete, sane draft has no problems", () => {
    expect(messages(draft())).toEqual([]);
    expect(canRecordFill(draft(), [], NOW)).toBe(true);
  });

  test("the empty draft is refused on quantity and price, and nothing else", () => {
    // The default `filledAt` is now, which is valid. Fees blank is not a
    // problem — blank is "not known", and that is allowed.
    expect(messages(emptyFillDraft(NOW))).toEqual(["quantity", "price"]);
  });

  test("a future time is refused", () => {
    expect(messages(draft({ filledAt: "2026-09-14T16:00" }))).toEqual(["filledAt"]);
  });

  test("an unreal time is refused", () => {
    expect(messages(draft({ filledAt: "2026-02-31T10:00" }))).toEqual(["filledAt"]);
  });

  test("quantity must be positive — the side is the order's", () => {
    expect(messages(draft({ quantity: 0 }))).toEqual(["quantity"]);
    expect(messages(draft({ quantity: -5 }))).toEqual(["quantity"]);
    const [p] = validateFillDraft(draft({ quantity: -5 }), [], NOW);
    expect(p.message).toContain("order's side");
  });

  test("price must be positive — zero is a missing price", () => {
    expect(messages(draft({ price: 0 }))).toEqual(["price"]);
  });

  test("blank fees are NOT a problem; negative fees are", () => {
    expect(messages(draft({ fees: null }))).toEqual([]);
    expect(messages(draft({ fees: 0 }))).toEqual([]);
    expect(messages(draft({ fees: -1 }))).toEqual(["fees"]);
  });

  test("a duplicate broker reference on this order is refused, case-insensitively", () => {
    const existing = [fill({ broker_ref: "ABC-1" })];
    expect(messages(draft({ brokerRef: "abc-1" }), existing)).toEqual(["brokerRef"]);
    expect(messages(draft({ brokerRef: "  ABC-1 " }), existing)).toEqual(["brokerRef"]);
  });

  test("a fresh broker reference is fine, and a blank one is null rather than a problem", () => {
    const existing = [fill({ broker_ref: "ABC-1" })];
    expect(messages(draft({ brokerRef: "ABC-2" }), existing)).toEqual([]);
    expect(messages(draft({ brokerRef: "   " }), existing)).toEqual([]);
  });

  test("several problems are ALL reported, each naming its box", () => {
    const problems = validateFillDraft(draft({ quantity: null, price: -1, fees: -2 }), [], NOW);
    expect(problems.map((p) => p.field)).toEqual(["quantity", "price", "fees"]);
  });
});

describe("agreement with fillRejection", () => {
  // The pin. For every draft whose time is valid, this validator is empty
  // exactly when the authority returns null. A form that accepted what the
  // mutation refused — or the reverse — is what this rules out.
  const existing = [fill({ broker_ref: "DUP" })];
  const matrix: FillDraft[] = [
    draft(),
    draft({ quantity: null }),
    draft({ quantity: 0 }),
    draft({ quantity: -1 }),
    draft({ quantity: Number.NaN }),
    draft({ price: null }),
    draft({ price: 0 }),
    draft({ price: Number.POSITIVE_INFINITY }),
    draft({ fees: null }),
    draft({ fees: 0 }),
    draft({ fees: 2.5 }),
    draft({ fees: -1 }),
    draft({ fees: Number.NaN }),
    draft({ brokerRef: null }),
    draft({ brokerRef: "" }),
    draft({ brokerRef: "   " }),
    draft({ brokerRef: "dup" }),
    draft({ brokerRef: " DUP " }),
    draft({ brokerRef: "fresh" }),
    draft({ quantity: -1, price: 0, fees: -1, brokerRef: "dup" }),
  ];

  test("NEGATIVE CONTROL: the matrix contains both accepted and refused drafts", () => {
    const verdicts = matrix.map((d) => fillRejection(candidateOf(d), existing) === null);
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });

  test("empty problems ⇔ fillRejection null, for every draft in the matrix", () => {
    for (const d of matrix) {
      const here = canRecordFill(d, existing, NOW);
      const authority = fillRejection(candidateOf(d), existing) === null;
      expect({ draft: d, here }).toEqual({ draft: d, here: authority });
    }
  });
});

describe("fillInsert", () => {
  test("NEGATIVE CONTROL: a valid draft becomes a complete row", () => {
    const row = fillInsert({ userId: "u1", orderId: "o1", draft: draft({ fees: 1.5, brokerRef: " X-9 ", note: " ok " }) });
    expect(row.user_id).toBe("u1");
    expect(row.order_id).toBe("o1");
    expect(row.quantity).toBe(10);
    expect(row.price).toBe(100);
    expect(row.fees).toBe(1.5);
    expect(row.broker_ref).toBe("X-9");
    expect(row.note).toBe("ok");
  });

  test("the local minute becomes an instant — the same moment, as ISO", () => {
    const row = fillInsert({ userId: "u1", orderId: "o1", draft: draft({ filledAt: PAST }) });
    expect(new Date(row.filled_at).getTime()).toBe(new Date(PAST).getTime());
    expect(row.filled_at.endsWith("Z")).toBe(true);
  });

  test("NULL fees stay NULL — never zeroed on the way in", () => {
    const row = fillInsert({ userId: "u1", orderId: "o1", draft: draft({ fees: null }) });
    expect(row.fees).toBeNull();
  });

  test("blank reference and note become NULL, not empty strings", () => {
    // `fills_bounds` forbids a blank reference; an empty string would reach
    // the CHECK and come back as a Postgres error.
    const row = fillInsert({ userId: "u1", orderId: "o1", draft: draft({ brokerRef: "  ", note: "" }) });
    expect(row.broker_ref).toBeNull();
    expect(row.note).toBeNull();
  });

  test("source defaults to user_entry — a typed form is a person", () => {
    expect(fillInsert({ userId: "u1", orderId: "o1", draft: draft() }).source).toBe("user_entry");
  });

  test("an explicit source is kept", () => {
    expect(fillInsert({ userId: "u1", orderId: "o1", draft: draft(), source: "imported" }).source).toBe("imported");
  });
});

describe("emptyFillDraft", () => {
  test("it is dated now and otherwise empty", () => {
    expect(emptyFillDraft(NOW)).toEqual({
      filledAt: "2026-09-14T15:30",
      quantity: null,
      price: null,
      fees: null,
      brokerRef: null,
      note: null,
    });
  });
});
