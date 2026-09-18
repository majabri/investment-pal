// The app side of the per-consumer cursor (ADR-APP-018). What a consumer does
// with a page of outbox rows is decided here; the database holds the other
// half (eventConsumers.test.ts under schema/). Ids and names are synthetic.
import { describe, expect, test } from "bun:test";

import {
  GOAL_CACHE_CONSUMER,
  GOAL_EVENT,
  GOAL_QUERY_KEYS,
  OUTBOX_PAGE,
  consumePlan,
  cursorSentence,
  readOutboxRows,
} from "../eventConsumers";

describe("readOutboxRows", () => {
  test("reads integer ids as numbers or digit strings; the type as a non-empty string", () => {
    const r = readOutboxRows([
      { id: 7, event_type: "GoalChanged" },
      { id: "8", event_type: "QuoteUpdated" },
    ]);
    expect(r.events).toEqual([{ id: 7, event_type: "GoalChanged" }, { id: 8, event_type: "QuoteUpdated" }]);
    expect(r.unreadable).toBe(0);
  });

  test("counts what it cannot read; never drops it silently, never guesses", () => {
    const r = readOutboxRows([
      { id: 7, event_type: "GoalChanged" },
      { id: "seven", event_type: "GoalChanged" },
      { id: 7.5, event_type: "GoalChanged" },
      { id: -1, event_type: "GoalChanged" },
      { id: 9, event_type: null },
      { id: 10, event_type: "" },
    ]);
    expect(r.events).toHaveLength(1);
    expect(r.unreadable).toBe(5);
  });
});

describe("consumePlan", () => {
  const events = [
    { id: 5, event_type: "QuoteUpdated" },
    { id: 6, event_type: GOAL_EVENT },
    { id: 9, event_type: "AlertRaised" },
    { id: 12, event_type: GOAL_EVENT },
  ];

  test("handles only events past the cursor and advances to the highest of them", () => {
    const p = consumePlan(events, 4);
    expect(p.handled).toBe(4);
    expect(p.behind).toBe(0);
    expect(p.next).toBe(12);
    expect(p.goalChanged).toBe(2);
    expect(p.invalidate).toEqual(GOAL_QUERY_KEYS);
  });

  test("events at or before the cursor are behind: counted, never re-handled, never moving the cursor", () => {
    const p = consumePlan(events, 9);
    expect(p.behind).toBe(3);
    expect(p.handled).toBe(1);
    expect(p.next).toBe(12);
    expect(p.goalChanged).toBe(1);
  });

  test("nothing past the cursor: next equals the cursor, nothing to invalidate", () => {
    const p = consumePlan(events, 12);
    expect(p).toEqual({ next: 12, handled: 0, behind: 4, goalChanged: 0, invalidate: [] });
    expect(consumePlan([], 3).next).toBe(3);
  });

  test("other events are passed, not acted on: the cursor moves, no cache is touched", () => {
    const p = consumePlan([{ id: 20, event_type: "QuoteUpdated" }, { id: 21, event_type: "FillRecorded" }], 12);
    expect(p.next).toBe(21);
    expect(p.handled).toBe(2);
    expect(p.goalChanged).toBe(0);
    expect(p.invalidate).toEqual([]);
  });

  test("order of arrival does not matter; the highest id wins", () => {
    expect(consumePlan([{ id: 30, event_type: "x" }, { id: 28, event_type: "x" }], 0).next).toBe(30);
  });

  test("the goal caches are the two keys useAppData owns", () => {
    expect(GOAL_QUERY_KEYS).toEqual([["goal"], ["goal_versions"]]);
    expect(GOAL_CACHE_CONSUMER).toMatch(/^[a-z][a-z0-9_]{1,62}$/); // the migration's CHECK
    expect(OUTBOX_PAGE).toBeGreaterThan(0);
  });
});

describe("cursorSentence", () => {
  const now = new Date("2026-09-18T20:00:00Z");

  test("no row: says not registered, never invents a position", () => {
    expect(cursorSentence(null, now)).toContain("not registered");
    expect(cursorSentence(undefined, now)).not.toMatch(/#\d/);
  });

  test("a row: names the consumer, the event it is past, and how long ago", () => {
    const s = cursorSentence({ name: GOAL_CACHE_CONSUMER, last_event_id: 41, updated_at: "2026-09-18T19:57:00Z" }, now);
    expect(s).toBe(`${GOAL_CACHE_CONSUMER}: past event #41, advanced 3 minutes ago.`);
  });

  test("a cursor at 0 is before any event, which is a fact; a bad time is unknown, not 0 minutes", () => {
    expect(cursorSentence({ name: "c", last_event_id: 0, updated_at: "2026-09-18T20:00:00Z" }, now)).toBe("c: before any event, advanced within the last minute.");
    expect(cursorSentence({ name: "c", last_event_id: "5", updated_at: "not a time" }, now)).toContain("at an unknown time");
  });
});
