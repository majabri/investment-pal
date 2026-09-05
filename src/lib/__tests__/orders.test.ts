// Phase 6, rule 19: the broker-neutral order model.
//
// The reason this exists before any screen needs it: `readiness.ts` hardcoded
// `openOrdersKnown: false` for every caller, because there was no data that
// could make it true. That was the honest value AND a permanent block on the
// position-sizing capability. The distinction that matters is not "are there
// orders" but "has anybody told us" — an empty table is not an answer.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  EXECUTION_SOURCES,
  ORDER_STATUSES,
  committedCash,
  isCommitted,
  openOrdersKnown,
  remainingQuantity,
  totalCommittedCash,
} from "../orders";

const NOW = new Date("2026-09-05T12:00:00Z");

const order = (over: Partial<Parameters<typeof remainingQuantity>[0]> = {}) => ({
  status: "open",
  side: "buy",
  quantity: 10,
  filled_quantity: null,
  limit_price: 100,
  order_type: "limit",
  ...over,
});

describe("isCommitted", () => {
  test("working statuses commit capital", () => {
    for (const s of ["pending_new", "open", "partially_filled"]) {
      expect(isCommitted(s)).toBe(true);
    }
  });

  test("finished statuses do not", () => {
    for (const s of ["filled", "cancelled", "rejected", "expired"]) {
      expect(isCommitted(s)).toBe(false);
    }
  });

  test("UNKNOWN counts as committed", () => {
    // An order whose state could not be mapped MIGHT be working. Treating it
    // as closed is the assumption that loses money: it frees capital the app
    // cannot prove is free.
    expect(isCommitted("unknown")).toBe(true);
  });

  test("every status in the vocabulary is classified", () => {
    // A status added later and forgotten here would silently become "not
    // committed", which is the unsafe default.
    for (const s of ORDER_STATUSES) expect(typeof isCommitted(s)).toBe("boolean");
  });
});

describe("remainingQuantity", () => {
  test("a working order with a known size", () => {
    expect(remainingQuantity(order())).toBe(10);
  });

  test("a finished order has nothing working", () => {
    expect(remainingQuantity(order({ status: "filled" }))).toBe(0);
  });

  test("an unknown size is null, not the full size", () => {
    expect(remainingQuantity(order({ quantity: null }))).toBeNull();
  });

  test("a partial fill with an unknown filled amount is null", () => {
    // NOT `quantity - 0`. Reporting the full size as still working overstates
    // the commitment exactly when the app knows least.
    expect(
      remainingQuantity(order({ status: "partially_filled", filled_quantity: null })),
    ).toBeNull();
  });

  test("a partial fill subtracts what filled", () => {
    expect(remainingQuantity(order({ status: "partially_filled", filled_quantity: 4 }))).toBe(6);
  });

  test("an over-fill is zero remaining, not negative", () => {
    // The column deliberately permits filled > quantity so the evidence
    // survives; a negative commitment would flow into a total.
    expect(remainingQuantity(order({ status: "partially_filled", filled_quantity: 12 }))).toBe(0);
  });
});

describe("committedCash", () => {
  test("a working limit buy commits price x remaining", () => {
    expect(committedCash(order())).toBe(1000);
  });

  test("a sell commits no cash", () => {
    expect(committedCash(order({ side: "sell" }))).toBe(0);
  });

  test("a market buy is UNKNOWABLE, not zero", () => {
    // A screen reporting $0 committed for three working market orders tells
    // the user capital is free that is not.
    expect(committedCash(order({ order_type: "market" }))).toBeNull();
    expect(committedCash(order({ order_type: "stop" }))).toBeNull();
  });

  test("a limit order with no price is unknowable", () => {
    expect(committedCash(order({ limit_price: null }))).toBeNull();
  });

  test("a finished order commits nothing", () => {
    expect(committedCash(order({ status: "cancelled" }))).toBe(0);
  });

  test("NEGATIVE CONTROL: a real commitment is a number", () => {
    // Without this every null assertion above passes on `() => null`.
    expect(typeof committedCash(order())).toBe("number");
  });
});

describe("totalCommittedCash", () => {
  test("sums what it can price", () => {
    expect(totalCommittedCash([order(), order({ quantity: 5 })])).toBe(1500);
  });

  test("one unpriceable order makes the total unavailable", () => {
    // All-or-nothing, like `sumField` and `combinedTarget`. "The total of the
    // orders we happen to be able to price" is not the committed total, and
    // there is no way to render it that does not read as one.
    expect(totalCommittedCash([order(), order({ order_type: "market" })])).toBeNull();
  });

  test("no orders is zero, and that is a known fact", () => {
    // Different from the null cases: nothing to add IS an answer. Whether the
    // list is complete is `openOrdersKnown`'s question, not this one's.
    expect(totalCommittedCash([])).toBe(0);
  });
});

describe("openOrdersKnown", () => {
  const acct = (over = {}) => ({
    orders_as_of: "2026-09-05T09:00:00Z",
    orders_source: "imported",
    ...over,
  });

  test("recently reported orders are known", () => {
    expect(openOrdersKnown(acct(), NOW)).toBe(true);
  });

  test("never reported is NOT known", () => {
    // The shipped state for every existing account, and the reason the gate
    // could only answer `false` before this module existed.
    expect(openOrdersKnown(acct({ orders_as_of: null }), NOW)).toBe(false);
    expect(openOrdersKnown(null, NOW)).toBe(false);
  });

  test("reported too long ago is not known either", () => {
    expect(openOrdersKnown(acct({ orders_as_of: "2026-08-01T09:00:00Z" }), NOW)).toBe(false);
  });

  test("a timestamp in the future is not known", () => {
    // A clock error must not read as the freshest possible data — the same
    // call `freshnessOf` makes.
    expect(openOrdersKnown(acct({ orders_as_of: "2027-01-01T00:00:00Z" }), NOW)).toBe(false);
  });

  test("a malformed timestamp is not known", () => {
    expect(openOrdersKnown(acct({ orders_as_of: "yesterday" }), NOW)).toBe(false);
  });

  test("it does NOT depend on there being any orders", () => {
    // The whole point. An account whose orders were read and reported nothing
    // working is KNOWN to have none; an account nobody has read is not. A
    // count of rows cannot tell those apart, so this takes the timestamp.
    expect(openOrdersKnown(acct(), NOW)).toBe(true);
  });
});

describe("the vocabularies stay broker-neutral", () => {
  test("no status names a broker's own wording", () => {
    // Rule 19 asks for generic statuses, and rule 8's "never infer accounting
    // from a label" is why: a broker's status string is a label, and mapping
    // it belongs in that broker's adapter.
    const brokerisms = ["working", "queued", "part_filled", "pendingcancel", "replaced"];
    for (const b of brokerisms) {
      expect(ORDER_STATUSES as readonly string[]).not.toContain(b);
    }
  });

  test("there is no AI execution source", () => {
    // Rule 18: a model may never be the source of an open order.
    expect(EXECUTION_SOURCES as readonly string[]).not.toContain("ai");
    expect([...EXECUTION_SOURCES].sort()).toEqual(["imported", "user_entry"]);
  });

  test("the migration's CHECK matches the module's vocabulary", () => {
    // Two lists that must agree, in two languages. When they drift, a value
    // the app considers valid is rejected by the database at write time —
    // which surfaces as a Postgres error on the user's screen.
    const sql = readFileSync("supabase/migrations/20260905280000_orders.sql", "utf8");
    for (const s of ORDER_STATUSES) expect(sql).toContain(`'${s}'`);
    for (const e of EXECUTION_SOURCES) expect(sql).toContain(`'${e}'`);
    expect(sql).toContain("execution_source IN ('imported', 'user_entry')");
  });

  test("NEGATIVE CONTROL: the migration would not contain an invented status", () => {
    const sql = readFileSync("supabase/migrations/20260905280000_orders.sql", "utf8");
    expect(sql).not.toContain("'working'");
  });
});

describe("the readiness gate stops hardcoding false", () => {
  test("readinessInput asks orders.ts rather than writing a literal", () => {
    const src = readFileSync("src/lib/readinessInput.ts", "utf8");
    expect(src).toContain("openOrdersKnown(");
    // The literal that was there. It is quoted in a COMMENT explaining the
    // change, so the check is for the assignment shape rather than the words.
    expect(src).not.toMatch(/openOrdersKnown:\s*false/);
  });

  test("NEGATIVE CONTROL: that pattern matches the line that was removed", () => {
    expect("    openOrdersKnown: false,").toMatch(/openOrdersKnown:\s*false/);
  });
});
