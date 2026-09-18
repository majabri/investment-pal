// What the event record says (§19.1, §24, SYS-004).
import { describe, expect, test } from "bun:test";

import {
  EMPTY_ACTIVITY,
  EVENT_TYPES,
  activitySentence,
  describeType,
  readActivity,
  sortActivity,
  unreadableActivityNote,
} from "@/lib/activityView";
import type { ActivityEvent, ActivityRow } from "@/lib/activityView";
import { readFileSync } from "node:fs";

const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  id: 1,
  event_type: "HoldingsReconciled",
  aggregate_type: "holdings",
  aggregate_id: "00000000-0000-0000-0000-000000000001",
  account_id: null,
  occurred_at: "2026-09-17T15:00:00Z",
  payload: { op: "UPDATE", changed: ["quantity"] },
  audit_log: { op: "UPDATE", old_row: { symbol: "AAA", quantity: 10 }, new_row: { symbol: "AAA", quantity: 12 } },
  ...over,
});
const ev = (over: Partial<ActivityRow> = {}): ActivityEvent => readActivity([row(over)]).events[0];

describe("the vocabulary", () => {
  test("the fourteen names are the migration's CHECK, verbatim", () => {
    const sql = readFileSync("supabase/migrations/20260917150000_events_audit_imports_orders.sql", "utf8");
    for (const t of EVENT_TYPES) expect(sql).toContain(`'${t}'`);
    expect(EVENT_TYPES).toHaveLength(14);
  });
  test("readActivity keeps the known and COUNTS the unknown", () => {
    const r = readActivity([row(), row({ id: 2, event_type: "SomethingElse" })]);
    expect(r.events).toHaveLength(1);
    expect(r.unreadable).toBe(1);
    expect(unreadableActivityNote(r)).toContain("1 event could not be read");
  });
  test("NEGATIVE CONTROL: all readable, no note", () => {
    expect(unreadableActivityNote(readActivity([row()]))).toBeNull();
  });
  test("describeType splits the name into words", () => {
    expect(describeType("HoldingsReconciled")).toBe("Holdings Reconciled");
  });
});

describe("activitySentence", () => {
  test("a quantity change names the symbol and both figures", () => {
    expect(activitySentence(ev())).toBe("AAA: quantity 10 → 12.");
  });
  test("a price-only update is a quote", () => {
    expect(
      activitySentence(
        ev({ event_type: "QuoteUpdated", payload: { op: "UPDATE", changed: ["current_price", "last_price_at"] }, audit_log: { op: "UPDATE", old_row: { symbol: "AAA", current_price: 100 }, new_row: { symbol: "AAA", current_price: 101.5 } } }),
      ),
    ).toBe("AAA quote: 100 → 101.5.");
  });
  test("an insert and a delete of a holding", () => {
    expect(activitySentence(ev({ audit_log: { op: "INSERT", old_row: null, new_row: { symbol: "BBB", quantity: "7.5" } } }))).toBe("BBB recorded: 7.5 shares.");
    expect(activitySentence(ev({ audit_log: { op: "DELETE", old_row: { symbol: "BBB", quantity: 7.5 }, new_row: null } }))).toBe("BBB removed (7.5 shares).");
  });
  test("a policy change names each column with both values", () => {
    expect(
      activitySentence(
        ev({ event_type: "PolicyChanged", aggregate_type: "ips_lite", payload: { op: "UPDATE", changed: ["position_cap_pct"] }, audit_log: { op: "UPDATE", old_row: { position_cap_pct: 30 }, new_row: { position_cap_pct: 25 } } }),
      ),
    ).toBe("Policy changed: position cap pct 30 → 25.");
  });
  test("a decision, followed, and an outcome", () => {
    const n = { action: "ADD", symbol: "AAA", recommendation: "Add into the pullback." };
    expect(activitySentence(ev({ event_type: "DecisionCreated", audit_log: { op: "INSERT", old_row: null, new_row: n } }))).toBe("Decision recorded: ADD AAA — Add into the pullback.");
    expect(activitySentence(ev({ event_type: "DecisionAccepted", audit_log: { op: "UPDATE", old_row: { ...n, decision: "pending" }, new_row: { ...n, decision: "followed" } } }))).toBe("Decision followed: ADD AAA — Add into the pullback.");
    expect(activitySentence(ev({ event_type: "OutcomeMeasured", payload: { op: "UPDATE", changed: ["outcome_1d"] }, audit_log: { op: "UPDATE", old_row: { ...n }, new_row: { ...n, outcome_1d: 1.5 } } }))).toBe("Outcome measured on ADD AAA: outcome 1d 1.5.");
  });
  test("a fill with fees not known says so — not known is not free", () => {
    expect(activitySentence(ev({ event_type: "FillRecorded", audit_log: { op: "INSERT", old_row: null, new_row: { quantity: 5, price: 100, fees: null } } }))).toBe("Fill recorded: 5 @ 100, fees not known.");
    expect(activitySentence(ev({ event_type: "FillRecorded", audit_log: { op: "INSERT", old_row: null, new_row: { quantity: 5, price: 100, fees: 0 } } }))).toBe("Fill recorded: 5 @ 100.");
  });
  test("a tranche closed, an order opened, a valuation, an alert, a goal", () => {
    expect(activitySentence(ev({ event_type: "TrancheClosed", audit_log: { op: "UPDATE", old_row: { symbol: "AAA", kind: "tactical", opened_quantity: 10, closed_at: null }, new_row: { symbol: "AAA", kind: "tactical", opened_quantity: 10, closed_at: "x" } } }))).toBe("AAA tactical tranche closed (10 shares opened).");
    expect(activitySentence(ev({ event_type: "OrderOpened", audit_log: { op: "INSERT", old_row: null, new_row: { symbol: "AAA", side: "buy", order_type: "stop", status: "untriggered" } } }))).toBe("Order opened: buy AAA stop (untriggered).");
    expect(activitySentence(ev({ event_type: "ValuationCompleted", audit_log: { op: "INSERT", old_row: null, new_row: { net: 900, gross: 1000 } } }))).toBe("Valuation snapshot: net 900, gross 1,000.");
    expect(activitySentence(ev({ event_type: "AlertRaised", audit_log: { op: "INSERT", old_row: null, new_row: { message: "Positions were last imported 3 days ago." } } }))).toBe("Alert raised: Positions were last imported 3 days ago.");
    expect(activitySentence(ev({ event_type: "GoalChanged", audit_log: { op: "INSERT", old_row: null, new_row: { target_value: 100000, target_date: "2030-06-30" } } }))).toBe("Goal version recorded: target 100,000 by 2030-06-30.");
  });
  test("a pruned audit row is said, not guessed around", () => {
    expect(activitySentence(ev({ audit_log: null }))).toBe("Holdings Reconciled — details not kept.");
  });
  test("every type yields a non-empty sentence even with an empty audit row", () => {
    for (const t of EVENT_TYPES) {
      const s = activitySentence(ev({ event_type: t, payload: {}, audit_log: { op: "INSERT", old_row: null, new_row: {} } }));
      expect(s.length).toBeGreaterThan(5);
    }
  });
});

describe("order and empty state", () => {
  test("newest first, id as the tiebreak", () => {
    const s = sortActivity([
      { id: 1, occurred_at: "2026-09-17T15:00:00Z" },
      { id: 3, occurred_at: "2026-09-17T16:00:00Z" },
      { id: 2, occurred_at: "2026-09-17T16:00:00Z" },
    ]);
    expect(s.map((x) => x.id)).toEqual([3, 2, 1]);
  });
  test("the empty state says the record is new, not that nothing happened", () => {
    expect(EMPTY_ACTIVITY).toContain("starts with the first write");
    expect(EMPTY_ACTIVITY).not.toMatch(/nothing (ever )?happened/i);
  });
});
