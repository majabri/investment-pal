// The daily close is a close (OBS-001; §B.2; DATA-002).
//
// `price_history.close` is read by the swing score and by decision grading as
// the day's official closing price. Before this module the recorder wrote
// whatever the live quote said whenever /portfolio was open, stamped with the
// USER'S calendar date: a 10:15 print filed as that day's close; a Friday close
// seen on a Sunday filed as Sunday's. Both are wrong in a way no reader can
// detect afterwards — the row looks exactly like a real close.
//
// The rule here: a quote is a close only when the provider's own clock says the
// regular session it belongs to has ended, and the date on the row is the
// EXCHANGE'S calendar date for the quote's own time. Anything else is skipped,
// and the skip carries its reason so the screen can say why a day is missing
// rather than filling it in. A missed close is a gap, never yesterday carried
// forward.
//
// What this does NOT do: run without a person on the page. Recording is still
// client-triggered; a scheduled server job (§27.1) is a separate decision, and
// this module is what such a job would call.
import type { ProvenancedQuote } from "./quoteProvenance";

/** Why a quote was not written as a close. Each is a different defect. */
export type CloseSkipReason =
  /** `price` is not a finite positive number. */
  | "no_price"
  /** The provider did not stamp the quote with its own time. */
  | "no_as_of"
  /** The provider gave no trading periods, so a close cannot be told from a print. */
  | "session_unknown"
  /** The regular session is in progress: this is a print, not a close. */
  | "intraday"
  /** The provider gave no usable exchange timezone; the date would be a guess. */
  | "no_exchange_zone";

export type CloseVerdict =
  | { kind: "close"; date: string; close: number }
  | { kind: "skipped"; reason: CloseSkipReason };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The calendar date of an instant in a named timezone, `YYYY-MM-DD`. NULL when
 * the instant does not parse or the zone is not one the runtime knows — not the
 * UTC date, which is off by a day for every exchange east of Greenwich in the
 * morning and every one west of it in the evening.
 */
export function exchangeDate(iso: string, timeZone: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const out = `${get("year")}-${get("month")}-${get("day")}`;
    return DATE_RE.test(out) ? out : null;
  } catch {
    return null;
  }
}

type CloseInput = Pick<ProvenancedQuote, "price" | "quoteAsOf" | "session" | "exchangeTimezone">;

/**
 * Whether one quote is a close, and of which day.
 *
 * Outside the regular session — `pre` (the next morning), `post`, `closed` —
 * the provider's `regularMarketPrice` is the last regular close and its
 * `regularMarketTime` the moment that session ended, so the quote's own time
 * names the trading day. During the regular session it is a print. With no
 * session known it could be either, and the strict answer is to skip.
 */
export function closeOf(q: CloseInput): CloseVerdict {
  if (typeof q.price !== "number" || !Number.isFinite(q.price) || q.price <= 0) {
    return { kind: "skipped", reason: "no_price" };
  }
  if (q.quoteAsOf === null || Number.isNaN(new Date(q.quoteAsOf).getTime())) {
    return { kind: "skipped", reason: "no_as_of" };
  }
  if (q.session === null) return { kind: "skipped", reason: "session_unknown" };
  if (q.session === "regular") return { kind: "skipped", reason: "intraday" };
  if (q.exchangeTimezone === null) return { kind: "skipped", reason: "no_exchange_zone" };
  const date = exchangeDate(q.quoteAsOf, q.exchangeTimezone);
  if (date === null) return { kind: "skipped", reason: "no_exchange_zone" };
  return { kind: "close", date, close: q.price };
}

/** One row for `price_history`, less the owner (the writer adds `user_id`). */
export type CloseRow = { symbol: string; date: string; close: number; source: "yahoo" };

export type CloseBatch = {
  rows: CloseRow[];
  skipped: { symbol: string; reason: CloseSkipReason }[];
};

export const EMPTY_BATCH: CloseBatch = { rows: [], skipped: [] };

/** The closes among a set of quotes, sorted by symbol, and the skips with reasons. */
export function dailyCloseRows(quotes: Record<string, ProvenancedQuote> | undefined): CloseBatch {
  if (!quotes) return EMPTY_BATCH;
  const rows: CloseRow[] = [];
  const skipped: CloseBatch["skipped"] = [];
  for (const symbol of Object.keys(quotes).sort()) {
    const v = closeOf(quotes[symbol]!);
    if (v.kind === "close") rows.push({ symbol, date: v.date, close: v.close, source: "yahoo" });
    else skipped.push({ symbol, reason: v.reason });
  }
  return { rows, skipped };
}

/**
 * Identity of a batch for "already written": the same symbols on the same
 * dates. A new trading day changes it; a 60-second refetch of the same closes
 * does not. Order-independent.
 */
export function closeBatchKey(rows: readonly CloseRow[]): string {
  return rows
    .map((r) => `${r.symbol}@${r.date}`)
    .sort()
    .join(",");
}

/** The latest close date the batch carries — what "recorded through" means. NULL when it carries none. */
export function expectedCloseDate(batch: CloseBatch): string | null {
  let out: string | null = null;
  for (const r of batch.rows) if (out === null || r.date > out) out = r.date;
  return out;
}

export type CloseCoverage = {
  /** The date every held symbol should have a close for; NULL when the quotes cannot say. */
  expected: string | null;
  /** Latest stored close on or after `expected`. */
  current: string[];
  /** Stored history ends before `expected`. */
  behind: { symbol: string; last: string }[];
  /** No stored close at all. */
  none: string[];
  /** Has stored history, but `expected` is unknown so current/behind cannot be told. */
  undetermined: string[];
};

/**
 * Per held symbol, whether `price_history` reaches the expected date. Reads the
 * record as it is; it never fills a missing day from the one before.
 */
export function closeCoverage(
  history: readonly { symbol: string; date: string }[],
  symbols: readonly string[],
  expected: string | null,
): CloseCoverage {
  const last = new Map<string, string>();
  for (const h of history) {
    const prev = last.get(h.symbol);
    if (prev === undefined || h.date > prev) last.set(h.symbol, h.date);
  }
  const out: CloseCoverage = { expected, current: [], behind: [], none: [], undetermined: [] };
  for (const s of [...new Set(symbols)].sort()) {
    const l = last.get(s);
    if (l === undefined) out.none.push(s);
    else if (expected === null) out.undetermined.push(s);
    else if (l >= expected) out.current.push(s);
    else out.behind.push({ symbol: s, last: l });
  }
  return out;
}

/** What each skip reason means, in words a screen can show. */
export const SKIP_LABEL: Record<CloseSkipReason, string> = {
  no_price: "no usable price",
  no_as_of: "the provider did not time-stamp the quote",
  session_unknown: "the provider gave no session times",
  intraday: "the session is in progress",
  no_exchange_zone: "the provider named no exchange timezone",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The line under the quotes: how far the stored closes reach and, when nothing
 * is being recorded right now, why not. NULL when nothing is held.
 */
export function closeNotice(cov: CloseCoverage, batch: CloseBatch): string | null {
  const total = cov.current.length + cov.behind.length + cov.none.length + cov.undetermined.length;
  if (total === 0) return null;

  const parts: string[] = [];
  if (cov.expected === null) {
    const withHistory = cov.undetermined.length;
    parts.push(
      `Daily closes: ${withHistory} of ${plural(total, "held symbol")} ${withHistory === 1 ? "has" : "have"} stored history` +
        (cov.none.length > 0 ? `, ${cov.none.length} with none` : "") +
        `; whether the latest close is recorded cannot be told until a close is quoted.`,
    );
  } else if (cov.current.length === total) {
    parts.push(`Daily closes through ${cov.expected}: all ${plural(total, "held symbol")} recorded.`);
  } else {
    const oldest = cov.behind.reduce<string | null>((m, b) => (m === null || b.last < m ? b.last : m), null);
    parts.push(
      `Daily closes through ${cov.expected}: ${cov.current.length} of ${plural(total, "held symbol")} recorded` +
        (cov.behind.length > 0 ? `; ${cov.behind.length} behind (oldest last close ${oldest})` : "") +
        (cov.none.length > 0 ? `; ${cov.none.length} with no history` : "") +
        ".",
    );
  }

  if (batch.rows.length === 0 && batch.skipped.length > 0) {
    const counts = new Map<CloseSkipReason, number>();
    for (const s of batch.skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
    const why = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([r, n]) => (counts.size === 1 ? SKIP_LABEL[r] : `${SKIP_LABEL[r]} (${n})`))
      .join("; ");
    parts.push(`Not recording now: ${why}.`);
  }
  return parts.join(" ");
}
