// One insert per account per day (§19.3), and the loop that would break it.
//
// The recorder's four guards had no test file at all. The reasoning was sound
// and written down, but nothing would catch a regression — and one of the
// guards is an `eslint-disable` comment on a dependency array, which is exactly
// the kind of thing a later edit removes in good faith because nothing says
// what it is for.
//
// The first attempt at this tested the component, which meant mocking the
// account context and the query hooks — and, through them, importing the
// browser Supabase client into the test typecheck to assert four booleans.
// That surfaced two unrelated type errors and proved the approach wrong rather
// than the code. The decision is pure now; this tests it directly.
import { describe, expect, test } from "bun:test";

import { snapshotDecision, snapshotRefusal } from "@/lib/snapshotGate";
import type { SnapshotGateInput } from "@/lib/snapshotGate";

const OK: SnapshotGateInput = {
  gross: 120_000,
  net: 100_000,
  marginUsed: 20_000,
  isAccountScope: true,
  isLoading: false,
  isPending: false,
  lastRecordedDate: "2026-03-14",
  today: "2026-03-15",
};

describe("snapshotRefusal names which rule stopped it", () => {
  test("NEGATIVE CONTROL: a clean input records", () => {
    // Without this, every refusal below passes on a gate that refuses always,
    // which would be a different bug and a silent one.
    expect(snapshotRefusal(OK)).toBeNull();
    expect(snapshotDecision(OK).record).toBe(true);
  });

  test("the household scope is not an account", () => {
    // Snapshots are per account; the household has no single balance to record.
    expect(snapshotRefusal({ ...OK, isAccountScope: false })).toBe("not_an_account");
  });

  test("any unknown figure stops it, one at a time", () => {
    // A snapshot is permanent and append-only. A row derived from an unknown
    // balance is a wrong day that every later chart and reconciliation reads as
    // fact — and unlike a screen, it cannot be corrected by refreshing.
    expect(snapshotRefusal({ ...OK, gross: null })).toBe("unknown_balance");
    expect(snapshotRefusal({ ...OK, net: null })).toBe("unknown_balance");
    expect(snapshotRefusal({ ...OK, marginUsed: null })).toBe("unknown_balance");
  });

  test("a zero gross is the loading state, not an account worth nothing", () => {
    expect(snapshotRefusal({ ...OK, gross: 0 })).toBe("no_value_yet");
    expect(snapshotRefusal({ ...OK, gross: -1 })).toBe("no_value_yet");
  });

  test("a real zero NET is still recorded — only gross gates", () => {
    // An account whose equity is exactly zero is a fact worth a row. Gating on
    // net would silently drop the most interesting day a margin account has.
    expect(snapshotRefusal({ ...OK, net: 0 })).toBeNull();
  });

  test("nothing is written while the history is still arriving", () => {
    // Writing before the existing rows load cannot know whether today is
    // already recorded, so it would duplicate on every cold start.
    expect(snapshotRefusal({ ...OK, isLoading: true })).toBe("history_loading");
  });

  test("a write already in flight does not queue a second", () => {
    // The loop. The effect deliberately excludes the mutation from its
    // dependency array; this is the same rule stated where it can be proven.
    expect(snapshotRefusal({ ...OK, isPending: true })).toBe("write_in_flight");
  });

  test("today already recorded means nothing is written", () => {
    expect(snapshotRefusal({ ...OK, lastRecordedDate: "2026-03-15" })).toBe(
      "already_recorded_today",
    );
  });

  test("dedupe is by the OWNER's day, not UTC", () => {
    // `today` is passed in rather than read from the clock, so this holds at
    // every hour. Comparing UTC dates recorded a second row for what the user
    // calls the same day, every evening west of Greenwich — a defect that a
    // clock-reading test could only catch during the hours the two disagree.
    expect(snapshotRefusal({ ...OK, lastRecordedDate: "2026-03-15", today: "2026-03-15" })).toBe(
      "already_recorded_today",
    );
    // The same history, one owner-day later: writes.
    expect(snapshotRefusal({ ...OK, lastRecordedDate: "2026-03-15", today: "2026-03-16" })).toBeNull();
  });

  test("no history at all is not the same as today being recorded", () => {
    expect(snapshotRefusal({ ...OK, lastRecordedDate: null })).toBeNull();
  });

  test("the scope check comes before the balance check", () => {
    // Order matters for what the caller is told: a household scope has no
    // balance by definition, so reporting `unknown_balance` there would send
    // someone looking for a missing figure that was never expected.
    expect(snapshotRefusal({ ...OK, isAccountScope: false, gross: null })).toBe("not_an_account");
  });
});

describe("snapshotDecision carries the figures it proved", () => {
  test("a yes hands back all three, non-null", () => {
    const d = snapshotDecision(OK);
    expect(d).toEqual({
      record: true,
      figures: { gross: 120_000, net: 100_000, marginUsed: 20_000 },
    });
  });

  test("a no carries the reason and no figures", () => {
    const d = snapshotDecision({ ...OK, isPending: true });
    expect(d.record).toBe(false);
    expect(d).not.toHaveProperty("figures");
  });

  test("the figures are the INPUT's, not defaults", () => {
    // Guards against a builder that reaches for a fallback when a figure is
    // small — a zero net is a real balance and must survive.
    const d = snapshotDecision({ ...OK, net: 0 });
    expect(d.record && d.figures.net).toBe(0);
  });
});
