// What a live quote knows about itself (§B.2; PORT-002, CONST-004, DATA-002).
//
// Balances, orders, lots and cash flows all carry a source and an as-of, and
// the readiness gate reads them. Quotes carried nothing: `getPricesFn` returned
// a bare number, and `holdings.last_price_at` recorded when the cache was
// written rather than when the price was true. A quote from Friday's close,
// shown on Sunday, rendered in the same typeface as one from ten seconds ago.
//
// This module is the quote's provenance, and the one place that says what
// state a quote is in. Two rules from the rest of the app apply unchanged:
// a quote with no as-of is UNKNOWN freshness, never assumed fresh; and a
// figure the provider did not state is NULL — a delay of zero would claim
// real-time, which free tiers do not promise.
//
// Freshness is judged against the MARKET clock, not the wall clock. During a
// regular session a quote is stale after `DEFAULT_STALENESS.live_quote` hours;
// outside one the latest price the market has produced is the last close, and
// a quote from that close is current however many hours the weekend has added
// — up to the longest closure a trading calendar allows.
//
// Pure: no React, no Supabase client, no network.

import { DEFAULT_STALENESS, type Freshness } from "@/lib/freshness";

/**
 * The states a quote can be in. `IMPORTED_SNAPSHOT` is a balance's state — a
 * quote is never one — and excluding it here is what lets the compiler check
 * that every caption below is written.
 */
export type QuoteFreshness = Exclude<Freshness, "IMPORTED_SNAPSHOT">;

export type MarketSession = "pre" | "regular" | "post" | "closed";

export type QuoteProvenance = {
  provider: "yahoo";
  /** The quote's OWN time per the provider, ISO 8601. NULL when it did not say. */
  quoteAsOf: string | null;
  /** When the app fetched it, ISO 8601. Always known: the app did the fetching. */
  retrievedAt: string;
  /** The session the retrieval fell in. NULL when the provider gave no periods. */
  session: MarketSession | null;
  /** How far behind real time the provider says it is. NULL = not stated. */
  delaySeconds: number | null;
  /** The IANA zone the provider names for the exchange (`exchangeTimezoneName`).
   *  It is what turns the quote's own time into the exchange's calendar date,
   *  which is the date a close belongs to. NULL when not stated or not a zone
   *  the runtime knows — never a default; a wrong zone files a close under the
   *  wrong day. */
  exchangeTimezone: string | null;
};

/**
 * The provider's exchange timezone as a zone the runtime can use, or null.
 * Validated here so every consumer downstream can trust the string.
 */
export function exchangeZoneOf(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    return null;
  }
}

/** A quote as the app carries it: the figures, and where they came from. */
export type ProvenancedQuote = {
  price: number;
  prevClose: number;
  changePct: number;
} & QuoteProvenance;

export type TradingPeriod = { start: number; end: number };
export type TradingPeriods = {
  pre?: TradingPeriod | null;
  regular?: TradingPeriod | null;
  post?: TradingPeriod | null;
};

const within = (t: number, p: TradingPeriod | null | undefined): boolean =>
  p != null && Number.isFinite(p.start) && Number.isFinite(p.end) && t >= p.start && t < p.end;

/**
 * Which session an instant (unix seconds) falls in, given the provider's
 * periods for the trading day. NULL when there are no periods to judge by —
 * not "closed", which would be a claim.
 */
export function sessionOf(atSec: number, periods: TradingPeriods | null | undefined): MarketSession | null {
  if (!periods || (periods.pre == null && periods.regular == null && periods.post == null)) return null;
  if (within(atSec, periods.regular)) return "regular";
  if (within(atSec, periods.pre)) return "pre";
  if (within(atSec, periods.post)) return "post";
  return "closed";
}

/**
 * The provider's `currentTradingPeriod` as periods, or null when it is not the
 * shape expected. Each period is kept only when both bounds are finite
 * numbers; a half-stated period would make `within` a guess.
 */
export function tradingPeriodsOf(raw: unknown): TradingPeriods | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const period = (v: unknown): TradingPeriod | null => {
    if (v === null || typeof v !== "object") return null;
    const { start, end } = v as Record<string, unknown>;
    return typeof start === "number" && typeof end === "number" && Number.isFinite(start) && Number.isFinite(end)
      ? { start, end }
      : null;
  };
  const out: TradingPeriods = { pre: period(r.pre), regular: period(r.regular), post: period(r.post) };
  return out.pre === null && out.regular === null && out.post === null ? null : out;
}

/** Unix seconds from the provider → ISO, or null for anything that is not a finite positive number. */
export function isoFromUnixSeconds(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

/**
 * The longest a market is closed on an ordinary calendar: a holiday weekend
 * (Friday close → Tuesday open) is ~89 hours. A quote older than this outside
 * a session is not the last close; something has stopped.
 */
export const MARKET_CLOSED_WINDOW_HOURS = 96;

/**
 * The state of one quote.
 *
 * `price` unusable → UNAVAILABLE. No as-of → UNKNOWN. Stamped in the future →
 * UNKNOWN (a clock error is not the best possible data). Then by session:
 * in a regular session, the live-quote policy (DELAYED rather than CURRENT
 * when the provider states a delay); outside one, the closed-market window.
 * An unknown session takes the STRICT rule: a false "stale" is a nuisance,
 * a false "current" is the defect this module exists to remove.
 */
export function quoteFreshness(
  q: Pick<ProvenancedQuote, "price" | "quoteAsOf" | "session" | "delaySeconds">,
  now: Date = new Date(),
): QuoteFreshness {
  if (!Number.isFinite(q.price)) return "UNAVAILABLE";
  if (q.quoteAsOf === null) return "UNKNOWN";
  const at = new Date(q.quoteAsOf).getTime();
  if (Number.isNaN(at)) return "UNKNOWN";
  const hours = (now.getTime() - at) / 3_600_000;
  if (hours < 0) return "UNKNOWN";

  const delayed = q.delaySeconds !== null && q.delaySeconds > 0;
  if (q.session === "regular" || q.session === null) {
    const limit = delayed ? DEFAULT_STALENESS.delayed_quote : DEFAULT_STALENESS.live_quote;
    if (hours > limit) return "STALE";
    return delayed ? "DELAYED" : "CURRENT";
  }
  // pre / post / closed: the market's latest price is the last close.
  if (hours > MARKET_CLOSED_WINDOW_HOURS) return "STALE";
  return delayed ? "DELAYED" : "CURRENT";
}

const SESSION_LABEL: Record<MarketSession, string> = {
  pre: "pre-market",
  regular: "regular session",
  post: "after hours",
  closed: "market closed",
};

const hhmm = (iso: string): string =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/**
 * The caption beside one quoted price, or null when there is nothing to say.
 *
 * Null for CURRENT: a caption on every row is a caption nobody reads. Every
 * other state is said, with the quote's own time where it has one.
 */
export function quoteCaption(q: Pick<ProvenancedQuote, "price" | "quoteAsOf" | "session" | "delaySeconds">, now: Date = new Date()): string | null {
  const f = quoteFreshness(q, now);
  switch (f) {
    case "CURRENT":
      return null;
    case "DELAYED":
      return `delayed quote${q.quoteAsOf ? ` (as of ${hhmm(q.quoteAsOf)})` : ""}`;
    case "STALE":
      return `stale quote (as of ${q.quoteAsOf!.slice(0, 10)})`;
    case "UNKNOWN":
      return "quote age not known";
    case "UNAVAILABLE":
      return "no quote";
  }
}

/**
 * The one line above a table of quoted prices: where they came from, when,
 * which session, and how many are not current. Null when there are no quotes
 * at all — nothing to describe.
 */
export function quoteBanner(quotes: Record<string, ProvenancedQuote> | undefined, now: Date = new Date()): string | null {
  const all = Object.values(quotes ?? {});
  if (all.length === 0) return null;
  const retrieved = all.map((q) => q.retrievedAt).sort().at(-1)!;
  const sessions = new Set(all.map((q) => q.session));
  const session =
    sessions.size === 1 ? [...sessions][0] : null;
  const delays = new Set(all.map((q) => q.delaySeconds));
  const delay =
    delays.size === 1 && [...delays][0] !== null
      ? `${[...delays][0]! / 60} min delayed`
      : "delay not stated by the provider";
  const notCurrent = all.filter((q) => quoteFreshness(q, now) !== "CURRENT").length;
  const parts = [
    `Quotes from Yahoo, retrieved ${hhmm(retrieved)}`,
    session === null ? "session not stated" : SESSION_LABEL[session],
    delay,
  ];
  const tail =
    notCurrent === 0
      ? ""
      : ` ${notCurrent} of ${all.length} ${notCurrent === 1 ? "is" : "are"} not current — see the caption beside each.`;
  return `${parts.join(" · ")}.${tail}`;
}
