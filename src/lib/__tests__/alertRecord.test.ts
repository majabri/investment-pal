// The alert record's pure half (§23.1, §16.1): identity, payload, the gate on
// writing, the row boundary, and what the panel may say about standing and
// seen.
import { describe, expect, test } from "bun:test";

import {
  acknowledgePatch,
  acknowledgementSentence,
  alertFingerprint,
  decorateAlerts,
  evaluationKey,
  raisePayload,
  readAlertRows,
  recordDecision,
  recordNote,
  standingSentence,
} from "@/lib/alertRecord";
import type { AlertRowLike, RecordGate, StoredAlert } from "@/lib/alertRecord";
import type { Alert } from "@/lib/alerts";

const stale = (days: number): Alert => ({
  type: "stale_quote",
  severity: "warning",
  message: `Positions were last imported ${days} days ago.`,
  href: "/settings",
});
const breach = (sym: string, pct: number): Alert => ({
  type: "concentration_breach",
  severity: "critical",
  message: `${sym} ${pct}% net equity > 25% cap`,
  href: "/portfolio",
});

describe("alertFingerprint — the identity across evaluations", () => {
  test("a figure that moves is the same alert", () => {
    expect(alertFingerprint(stale(3))).toBe(alertFingerprint(stale(4)));
    expect(alertFingerprint(stale(3))).toBe("stale_quote:Positions were last imported # days ago.");
  });
  test("percentages, decimals and thousands separators are all figures", () => {
    expect(alertFingerprint(breach("AAA", 42))).toBe(alertFingerprint(breach("AAA", 30.5)));
    expect(alertFingerprint({ type: "goal_pace", message: "Probability is 1,234.5%." })).toBe("goal_pace:Probability is #.");
  });
  test("a different symbol or a different type is a different alert", () => {
    expect(alertFingerprint(breach("AAA", 42))).not.toBe(alertFingerprint(breach("BBB", 42)));
    expect(alertFingerprint({ type: "margin_threshold", message: "x 1" })).not.toBe(alertFingerprint({ type: "concentration_breach", message: "x 1" }));
  });
  test("the fingerprint never carries the figure (the schema test's rule)", () => {
    expect(alertFingerprint(stale(3))).not.toContain("3");
  });
});

describe("raisePayload / evaluationKey", () => {
  test("one item per fingerprint, worst first kept, collapse counted", () => {
    const { items, collapsed } = raisePayload([breach("AAA", 42), stale(3), stale(4)]);
    expect(items.map((i) => i.fingerprint)).toEqual([alertFingerprint(breach("AAA", 42)), alertFingerprint(stale(3))]);
    expect(items[1]!.message).toBe(stale(3).message); // the first wording is the one sent
    expect(collapsed).toBe(1);
  });
  test("the key is order-independent and changes when the set changes", () => {
    const a = evaluationKey(raisePayload([breach("AAA", 42), stale(3)]).items);
    const b = evaluationKey(raisePayload([stale(9), breach("AAA", 1)]).items);
    expect(a).toBe(b); // same conditions, other figures, other order
    expect(evaluationKey(raisePayload([stale(3)]).items)).not.toBe(a);
    expect(evaluationKey([])).toBe("");
  });
});

describe("recordDecision — when the set may be sent", () => {
  const ok: RecordGate = { accountId: "acct", evaluationComplete: true, failed: false, lastSentKey: null, key: "k", isPending: false };
  test("a complete, changed evaluation for an account is sent", () => {
    expect(recordDecision(ok)).toEqual({ write: true });
  });
  test("each refusal is named", () => {
    expect(recordDecision({ ...ok, accountId: null })).toEqual({ write: false, reason: "no_account" });
    expect(recordDecision({ ...ok, failed: true })).toEqual({ write: false, reason: "failed" });
    expect(recordDecision({ ...ok, evaluationComplete: false })).toEqual({ write: false, reason: "evaluation_incomplete" });
    expect(recordDecision({ ...ok, isPending: true })).toEqual({ write: false, reason: "pending" });
    expect(recordDecision({ ...ok, lastSentKey: "k" })).toEqual({ write: false, reason: "unchanged" });
  });
  test("an incomplete evaluation is refused even when it would be a change — the guard that protects acknowledgements", () => {
    expect(recordDecision({ ...ok, evaluationComplete: false, lastSentKey: "other" }).write).toBe(false);
  });
  test("an empty set IS sent when complete: that is how everything resolves", () => {
    expect(recordDecision({ ...ok, key: "", lastSentKey: "k" })).toEqual({ write: true });
  });
});

const row = (over: Partial<AlertRowLike> = {}): AlertRowLike => ({
  id: "r1",
  type: "stale_quote",
  severity: "warning",
  message: "Positions were last imported 3 days ago.",
  href: "/settings",
  fingerprint: alertFingerprint(stale(3)),
  first_raised_at: "2026-09-15T14:00:00+00:00",
  last_raised_at: "2026-09-18T14:00:00+00:00",
  resolved_at: null,
  acknowledged_at: null,
  ...over,
});

describe("readAlertRows — the boundary", () => {
  test("a row in the domain is read whole", () => {
    const { alerts, unreadable } = readAlertRows([row()]);
    expect(unreadable).toBe(0);
    expect(alerts[0]).toEqual({
      id: "r1", type: "stale_quote", severity: "warning", message: "Positions were last imported 3 days ago.", href: "/settings",
      fingerprint: alertFingerprint(stale(3)), firstRaisedAt: "2026-09-15T14:00:00+00:00", lastRaisedAt: "2026-09-18T14:00:00+00:00",
      resolvedAt: null, acknowledgedAt: null,
    });
  });
  test("an unknown type or severity is counted, never dropped silently, never defaulted", () => {
    const { alerts, unreadable } = readAlertRows([row(), row({ id: "r2", type: "something_else" }), row({ id: "r3", severity: "loud" })]);
    expect(alerts.map((a) => a.id)).toEqual(["r1"]);
    expect(unreadable).toBe(2);
    expect(alerts.length + unreadable).toBe(3);
  });
});

describe("decorateAlerts — live is the truth about now; the record adds since-when and seen", () => {
  const stored: StoredAlert[] = readAlertRows([row(), row({ id: "gone", fingerprint: "goal_pace:x", type: "goal_pace", resolved_at: "2026-09-17T00:00:00+00:00" })]).alerts;
  test("a live alert finds its open row by fingerprint, whatever the figure now says", () => {
    const d = decorateAlerts([stale(5)], stored);
    expect(d[0]!.record?.id).toBe("r1");
  });
  test("a resolved row never decorates; a live alert without a row is unrecorded, not new", () => {
    const d = decorateAlerts([{ type: "goal_pace", severity: "warning", message: "x", href: "/goals" }, breach("AAA", 42)], stored);
    expect(d.map((x) => x.record)).toEqual([null, null]);
    expect(standingSentence(null, "2026-09-18")).toBe("not yet recorded");
  });
  test("negative control: the live list is never shortened by the record", () => {
    expect(decorateAlerts([stale(1), breach("AAA", 42)], []).length).toBe(2);
  });
});

describe("the sentences", () => {
  const rec = readAlertRows([row()]).alerts[0]!;
  test("standing: today, yesterday, and a count of days from the FIRST raise", () => {
    expect(standingSentence(rec, "2026-09-15")).toBe("since today");
    expect(standingSentence(rec, "2026-09-16")).toBe("since yesterday");
    expect(standingSentence(rec, "2026-09-18")).toBe("since 2026-09-15 (3 days)");
    // Negative control: not from the last raise, which would say "today".
    expect(standingSentence(rec, "2026-09-18")).not.toBe("since today");
  });
  test("seen is a date when acknowledged and nothing otherwise — never a reason to hide", () => {
    expect(acknowledgementSentence(rec)).toBeNull();
    expect(acknowledgementSentence({ ...rec, acknowledgedAt: "2026-09-16T09:00:00+00:00" })).toBe("seen 2026-09-16");
    expect(acknowledgementSentence(null)).toBeNull();
  });
  test("the patch is the one column", () => {
    expect(acknowledgePatch("2026-09-18T10:00:00.000Z")).toEqual({ acknowledged_at: "2026-09-18T10:00:00.000Z" });
  });
  test("the record note says unavailable, loading, or how many rows could not be read", () => {
    expect(recordNote("unavailable", 0)).toContain("could not be read");
    expect(recordNote("loading", 0)).toContain("Reading");
    expect(recordNote("ready", 0)).toBeNull();
    expect(recordNote("ready", 1)).toBe("1 stored alert could not be read and is not shown.");
    expect(recordNote("ready", 2)).toBe("2 stored alerts could not be read and are not shown.");
  });
});
