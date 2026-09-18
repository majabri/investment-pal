// The alert record: what `raiseAlerts()` computes, remembered (§23.1, §16.1).
//
// `alerts.ts` decides what wants attention on every render and forgets it on
// the next. The `alerts` table (20260917180000) holds the lifecycle: when a
// condition first appeared, when it was last seen true, when it went away,
// and whether the holder has said "seen". This module is the pure half of
// the join between the two: the identity that makes "3 days ago" and "4 days
// ago" one alert, the payload the RPC takes, the row boundary coming back,
// and the sentences the panel shows.
//
// Two rules it holds:
//
//   * An acknowledged alert is SHOWN as acknowledged, never hidden. The
//     condition is still true; "seen" is a fact about the holder.
//   * Nothing here decides raised / refreshed / re-raised / resolved. The
//     database compares and says (`raise_alerts`). The client only sends the
//     current set, and only when the evaluation is complete — a half-loaded
//     evaluation would resolve real alerts, and their re-raise a moment later
//     would clear the holder's acknowledgements.
import { ALERT_TYPES } from "./alerts";
import type { Alert, AlertSeverity, AlertType } from "./alerts";

/**
 * The identity of an alert across evaluations: its type and its message with
 * every figure blanked. A count, a percentage or a date that moves does not
 * make a new alert; a different symbol or a different sentence does.
 */
export function alertFingerprint(a: Pick<Alert, "type" | "message">): string {
  const blanked = a.message
    .replace(/\d[\d,.]*%?/g, "#")
    .replace(/\s+/g, " ")
    .trim();
  return `${a.type}:${blanked}`;
}

/** One element of `raise_alerts(p_alerts)`. */
export type RaisePayloadItem = Alert & { fingerprint: string };

/**
 * The set the RPC receives: every live alert with its fingerprint, one per
 * fingerprint. Two alerts that share an identity (the same condition worded
 * the same way) are one row; the first — worst first, as `raiseAlerts` sorts
 * — is the one sent, and the collapse is counted rather than silent.
 */
export function raisePayload(alerts: readonly Alert[]): { items: RaisePayloadItem[]; collapsed: number } {
  const seen = new Set<string>();
  const items: RaisePayloadItem[] = [];
  let collapsed = 0;
  for (const a of alerts) {
    const fingerprint = alertFingerprint(a);
    if (seen.has(fingerprint)) {
      collapsed++;
      continue;
    }
    seen.add(fingerprint);
    items.push({ ...a, fingerprint });
  }
  return { items, collapsed };
}

/** The identity of a whole evaluation: which conditions are true right now. */
export function evaluationKey(items: readonly RaisePayloadItem[]): string {
  return items
    .map((i) => i.fingerprint)
    .sort()
    .join("\n");
}

/** What the writer needs to know before it may call the RPC. */
export type RecordGate = {
  /** The account in scope. NULL = no single account: nothing to record against. */
  accountId: string | null;
  /** True only when every input to `raiseAlerts` has finished loading. */
  evaluationComplete: boolean;
  /** True when the evaluation itself failed (§23.2 ERROR). Never recorded. */
  failed: boolean;
  /** The key of the set already sent for this account, if any. */
  lastSentKey: string | null;
  /** The key of the set now. */
  key: string;
  /** A write already in flight. */
  isPending: boolean;
};

export type RecordDecision =
  | { write: true }
  | { write: false; reason: "no_account" | "evaluation_incomplete" | "failed" | "unchanged" | "pending" };

/**
 * Whether to send the current set. Refusals are named so a test can tell a
 * correct refusal from a broken effect, and so the same guard is not four
 * conditions in a `useEffect` nobody can see.
 */
export function recordDecision(g: RecordGate): RecordDecision {
  if (g.accountId === null) return { write: false, reason: "no_account" };
  if (g.failed) return { write: false, reason: "failed" };
  if (!g.evaluationComplete) return { write: false, reason: "evaluation_incomplete" };
  if (g.isPending) return { write: false, reason: "pending" };
  if (g.lastSentKey === g.key) return { write: false, reason: "unchanged" };
  return { write: true };
}

/** A stored alert as the panel reads it. Dates are ISO strings. */
export type StoredAlert = {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  href: string;
  fingerprint: string;
  firstRaisedAt: string;
  lastRaisedAt: string;
  resolvedAt: string | null;
  acknowledgedAt: string | null;
};

/** What the table's generated Row type looks like, structurally, so this module never imports the client. */
export type AlertRowLike = {
  id: string;
  type: string;
  severity: string;
  message: string;
  href: string;
  fingerprint: string;
  first_raised_at: string;
  last_raised_at: string;
  resolved_at: string | null;
  acknowledged_at: string | null;
};

const SEVERITIES: readonly string[] = ["critical", "warning", "info"];

/**
 * Rows into `StoredAlert`s, counting what could not be read. The generated
 * types say `string` for `type` and `severity`; the CHECK says eleven and
 * three. A row that fails the domain is counted, never dropped and never
 * defaulted to a severity it did not have.
 */
export function readAlertRows(rows: readonly AlertRowLike[]): { alerts: StoredAlert[]; unreadable: number } {
  const alerts: StoredAlert[] = [];
  let unreadable = 0;
  for (const r of rows) {
    if (!(ALERT_TYPES as readonly string[]).includes(r.type) || !SEVERITIES.includes(r.severity)) {
      unreadable++;
      continue;
    }
    alerts.push({
      id: r.id,
      type: r.type as AlertType,
      severity: r.severity as AlertSeverity,
      message: r.message,
      href: r.href,
      fingerprint: r.fingerprint,
      firstRaisedAt: r.first_raised_at,
      lastRaisedAt: r.last_raised_at,
      resolvedAt: r.resolved_at,
      acknowledgedAt: r.acknowledged_at,
    });
  }
  return { alerts, unreadable };
}

/** A live alert joined to its stored row, when one exists. */
export type DecoratedAlert = {
  alert: Alert;
  fingerprint: string;
  /** NULL = not in the record (not yet written, or the write failed). */
  record: StoredAlert | null;
};

/**
 * The live list is the truth about NOW; the record adds since-when and seen.
 * A live alert with no row is said to be unrecorded, not treated as new.
 */
export function decorateAlerts(live: readonly Alert[], stored: readonly StoredAlert[]): DecoratedAlert[] {
  const byFp = new Map<string, StoredAlert>();
  for (const s of stored) if (s.resolvedAt === null) byFp.set(s.fingerprint, s);
  return live.map((alert) => {
    const fingerprint = alertFingerprint(alert);
    return { alert, fingerprint, record: byFp.get(fingerprint) ?? null };
  });
}

const dayOf = (iso: string) => iso.slice(0, 10);

/** Whole calendar days between two ISO dates (local dates as given). */
function daysBetween(fromDay: string, toDay: string): number {
  const a = new Date(`${fromDay}T00:00:00Z`).getTime();
  const b = new Date(`${toDay}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * How long the condition has stood. `today` is the owner's local date
 * (`localIsoDate`), passed in so the sentence is testable at any hour.
 */
export function standingSentence(record: StoredAlert | null, today: string): string {
  if (record === null) return "not yet recorded";
  const since = dayOf(record.firstRaisedAt);
  const days = daysBetween(since, today);
  if (days <= 0) return "since today";
  if (days === 1) return "since yesterday";
  return `since ${since} (${days} days)`;
}

/** The holder's "seen", or the absence of it. Never hides the alert. */
export function acknowledgementSentence(record: StoredAlert | null): string | null {
  if (record === null || record.acknowledgedAt === null) return null;
  return `seen ${dayOf(record.acknowledgedAt)}`;
}

/** The one UPDATE the holder makes. */
export function acknowledgePatch(now: string): { acknowledged_at: string } {
  return { acknowledged_at: now };
}

/** The line under the list when the record could not be read or was short. */
export function recordNote(state: "loading" | "ready" | "unavailable", unreadable: number): string | null {
  if (state === "unavailable") {
    return "The alert record could not be read. What is shown is live; since-when and seen are not available.";
  }
  if (state === "loading") return "Reading the alert record…";
  if (unreadable > 0) {
    return `${unreadable} stored ${unreadable === 1 ? "alert" : "alerts"} could not be read and ${unreadable === 1 ? "is" : "are"} not shown.`;
  }
  return null;
}
