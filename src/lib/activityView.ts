// What the event record says, in the holder's terms (§19.1, §24, SYS-004).
//
// #233 gave the app an outbox (`domain_events`) and an audit log
// (`audit_log`) and nothing that read either. A record nobody can see is
// the same to the holder as no record: "user can inspect source/provenance
// for material decisions" (§24) needs a screen. This module turns one event
// and the audit row that raised it into one sentence, and counts what it
// cannot read rather than dropping it.
//
// Every figure shown here is one the audit row stored. Nothing is computed.
// Pure: no React, no Supabase client.

import type { Json } from "@/integrations/supabase/types";

/** The fourteen §19.1 names, verbatim — the CHECK in the migration. */
export const EVENT_TYPES = [
  "AccountImported",
  "HoldingsReconciled",
  "QuoteUpdated",
  "ValuationCompleted",
  "GoalChanged",
  "PolicyChanged",
  "DecisionCreated",
  "DecisionAccepted",
  "OrderOpened",
  "FillRecorded",
  "TrancheClosed",
  "OutcomeMeasured",
  "ModelEvaluated",
  "AlertRaised",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export function isEventType(v: string): v is EventType {
  return (EVENT_TYPES as readonly string[]).includes(v);
}

/** The audit row an event points at, as embedded by the read. NULL = pruned or never linked. */
export type AuditSlice = {
  op: string;
  old_row: Json | null;
  new_row: Json | null;
};

/** One event as the read returns it. Structural: the six columns plus the embed. */
export type ActivityRow = {
  id: number;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  account_id: string | null;
  occurred_at: string;
  payload: Json;
  audit_log: AuditSlice | null;
};

export type ActivityEvent = Omit<ActivityRow, "event_type"> & { event_type: EventType };

export type ActivityRead = {
  events: ActivityEvent[];
  /** Rows whose type is not one of the fourteen. Counted, never dropped silently. */
  unreadable: number;
};

export function readActivity(rows: readonly ActivityRow[]): ActivityRead {
  const events: ActivityEvent[] = [];
  let unreadable = 0;
  for (const r of rows) {
    if (isEventType(r.event_type)) events.push({ ...r, event_type: r.event_type });
    else unreadable += 1;
  }
  return { events, unreadable };
}

export function unreadableActivityNote(read: ActivityRead): string | null {
  if (read.unreadable === 0) return null;
  const n = read.unreadable;
  return `${n} event${n === 1 ? "" : "s"} could not be read and ${n === 1 ? "is" : "are"} not shown.`;
}

type Obj = Record<string, Json | undefined>;
const obj = (j: Json | null | undefined): Obj => (j !== null && typeof j === "object" && !Array.isArray(j) ? (j as Obj) : {});
const str = (o: Obj, k: string): string | null => (typeof o[k] === "string" ? (o[k] as string) : null);
const num = (o: Obj, k: string): number | null => {
  const v = o[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const money = (n: number | null): string =>
  n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const qty = (n: number | null): string =>
  n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 4 });
const changed = (payload: Json): string[] => {
  const c = obj(payload).changed;
  return Array.isArray(c) ? c.filter((x): x is string => typeof x === "string") : [];
};

/** The one sentence for an event. Never empty. Says "details not kept" when the audit row is gone. */
export function activitySentence(e: ActivityEvent): string {
  const a = e.audit_log;
  if (a === null) return `${describeType(e.event_type)} — details not kept.`;
  const n = obj(a.new_row);
  const o = obj(a.old_row);
  const sym = str(n, "symbol") ?? str(o, "symbol");
  switch (e.event_type) {
    case "QuoteUpdated":
      return `${sym ?? "A holding"} quote: ${money(num(o, "current_price"))} → ${money(num(n, "current_price"))}.`;
    case "HoldingsReconciled": {
      if (a.op === "INSERT") return `${sym ?? "A position"} recorded: ${qty(num(n, "quantity"))} shares.`;
      if (a.op === "DELETE") return `${sym ?? "A position"} removed (${qty(num(o, "quantity"))} shares).`;
      const q0 = num(o, "quantity");
      const q1 = num(n, "quantity");
      const cols = changed(e.payload);
      return q0 !== q1
        ? `${sym ?? "A position"}: quantity ${qty(q0)} → ${qty(q1)}.`
        : `${sym ?? "A position"} reconciled${cols.length ? ` (${cols.join(", ")})` : ""}.`;
    }
    case "AccountImported":
      return `Account "${str(n, "name") ?? "—"}" synced${str(n, "balances_as_of") ? ` (balances as of ${str(n, "balances_as_of")!.slice(0, 10)})` : ""}.`;
    case "PolicyChanged": {
      const cols = changed(e.payload);
      const parts = cols
        .filter((c) => c !== "updated_at")
        .map((c) => `${c.replace(/_/g, " ")} ${String(o[c] ?? "—")} → ${String(n[c] ?? "—")}`);
      return a.op === "INSERT"
        ? `Policy recorded: position cap ${num(n, "position_cap_pct") ?? "—"}%, margin cap ${num(n, "margin_cap_pct") ?? "—"}%.`
        : `Policy changed: ${parts.length ? parts.join("; ") : "no column differs"}.`;
    }
    case "GoalChanged":
      return `Goal version recorded: target ${money(num(n, "target_value"))}${str(n, "target_date") ? ` by ${str(n, "target_date")}` : ""}.`;
    case "DecisionCreated":
      return `Decision recorded: ${[str(n, "action"), sym].filter(Boolean).join(" ") || "portfolio"} — ${clip(str(n, "recommendation"))}`;
    case "DecisionAccepted":
      return `Decision followed: ${[str(n, "action"), sym].filter(Boolean).join(" ") || "portfolio"} — ${clip(str(n, "recommendation"))}`;
    case "OutcomeMeasured": {
      const cols = changed(e.payload).filter((c) => c.startsWith("outcome") || c === "grade");
      return `Outcome measured on ${[str(n, "action"), sym].filter(Boolean).join(" ") || "a decision"}: ${cols.map((c) => `${c.replace(/_/g, " ")} ${String(n[c] ?? "—")}`).join(", ") || "recorded"}.`;
    }
    case "OrderOpened":
      return `Order opened: ${str(n, "side") ?? "—"} ${sym ?? "—"} ${str(n, "order_type") ?? ""} (${str(n, "status") ?? "status unknown"}).`;
    case "FillRecorded":
      return `Fill recorded: ${qty(num(n, "quantity"))} @ ${money(num(n, "price"))}${num(n, "fees") === null ? ", fees not known" : ""}.`;
    case "TrancheClosed":
      return `${sym ?? "A"} ${str(n, "kind") ?? ""} tranche closed (${qty(num(n, "opened_quantity"))} shares opened).`;
    case "ValuationCompleted":
      return `Valuation snapshot: net ${money(num(n, "net"))}, gross ${money(num(n, "gross"))}.`;
    case "AlertRaised":
      return `Alert raised: ${str(n, "message") ?? describeType(e.event_type)}`;
    case "ModelEvaluated":
      return "Model evaluated.";
  }
}

const clip = (s: string | null, max = 80): string => {
  if (s === null) return "—";
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** The event name as words, for the badge and for the sentence when nothing else is known. */
export function describeType(t: EventType): string {
  return t.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Worst-first is not the order here: activity is a timeline, newest first. */
export function sortActivity<T extends Pick<ActivityEvent, "occurred_at" | "id">>(events: readonly T[]): T[] {
  return events.slice().sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : a.occurred_at > b.occurred_at ? -1 : b.id - a.id));
}

/**
 * What an empty list may say. The tables are new (2026-09-17): an empty
 * record is "nothing has been written since", not "nothing ever happened".
 */
export const EMPTY_ACTIVITY =
  "No events recorded yet. The record starts with the first write after the events tables were applied; earlier changes are not in it.";
