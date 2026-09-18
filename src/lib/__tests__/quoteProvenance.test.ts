// What a live quote knows about itself (§B.2; PORT-002, CONST-004, DATA-002).
import { describe, expect, test } from "bun:test";

import {
  MARKET_CLOSED_WINDOW_HOURS,
  exchangeZoneOf,
  isoFromUnixSeconds,
  quoteBanner,
  quoteCaption,
  quoteFreshness,
  sessionOf,
  tradingPeriodsOf,
} from "@/lib/quoteProvenance";
import type { ProvenancedQuote } from "@/lib/quoteProvenance";

// A fixed "now": 2026-09-17 14:30:00Z (a Thursday, mid-session in New York).
const NOW = new Date("2026-09-17T14:30:00Z");
const sec = (d: Date) => Math.floor(d.getTime() / 1000);
const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString();

// New York regular session on that day, in unix seconds.
const PERIODS = {
  pre: { start: sec(new Date("2026-09-17T08:00:00Z")), end: sec(new Date("2026-09-17T13:30:00Z")) },
  regular: { start: sec(new Date("2026-09-17T13:30:00Z")), end: sec(new Date("2026-09-17T20:00:00Z")) },
  post: { start: sec(new Date("2026-09-17T20:00:00Z")), end: sec(new Date("2026-09-18T00:00:00Z")) },
};

const quote = (over: Partial<ProvenancedQuote> = {}): ProvenancedQuote => ({
  price: 100,
  prevClose: 99,
  changePct: 1.01,
  provider: "yahoo",
  quoteAsOf: hoursAgo(0.1),
  retrievedAt: NOW.toISOString(),
  session: "regular",
  delaySeconds: null,
  exchangeTimezone: "America/New_York",
  ...over,
});

describe("sessionOf", () => {
  test("NEGATIVE CONTROL: mid-session is regular", () => {
    expect(sessionOf(sec(NOW), PERIODS)).toBe("regular");
  });
  test("pre, post, and closed by the periods' bounds", () => {
    expect(sessionOf(sec(new Date("2026-09-17T09:00:00Z")), PERIODS)).toBe("pre");
    expect(sessionOf(sec(new Date("2026-09-17T21:00:00Z")), PERIODS)).toBe("post");
    expect(sessionOf(sec(new Date("2026-09-17T03:00:00Z")), PERIODS)).toBe("closed");
  });
  test("the end bound is exclusive: the close instant is after hours", () => {
    expect(sessionOf(PERIODS.regular.end, PERIODS)).toBe("post");
  });
  test("no periods is NULL — not closed, which would be a claim", () => {
    expect(sessionOf(sec(NOW), null)).toBeNull();
    expect(sessionOf(sec(NOW), {})).toBeNull();
  });
});

describe("tradingPeriodsOf", () => {
  test("NEGATIVE CONTROL: the provider's shape reads through", () => {
    expect(tradingPeriodsOf({ pre: { start: 1, end: 2, timezone: "EDT" }, regular: { start: 2, end: 3 }, post: { start: 3, end: 4 } })).toEqual({
      pre: { start: 1, end: 2 },
      regular: { start: 2, end: 3 },
      post: { start: 3, end: 4 },
    });
  });
  test("a half-stated period is dropped, and nothing usable is null", () => {
    expect(tradingPeriodsOf({ regular: { start: 2 } })).toBeNull();
    expect(tradingPeriodsOf({ regular: { start: 2, end: 3 }, pre: { start: "x", end: 2 } })).toEqual({
      pre: null,
      regular: { start: 2, end: 3 },
      post: null,
    });
    expect(tradingPeriodsOf(undefined)).toBeNull();
    expect(tradingPeriodsOf("nope")).toBeNull();
  });
});

describe("isoFromUnixSeconds", () => {
  test("seconds → ISO; anything else → null", () => {
    expect(isoFromUnixSeconds(1_789_000_000)).toBe(new Date(1_789_000_000 * 1000).toISOString());
    expect(isoFromUnixSeconds(undefined)).toBeNull();
    expect(isoFromUnixSeconds("1789000000")).toBeNull();
    expect(isoFromUnixSeconds(0)).toBeNull();
    expect(isoFromUnixSeconds(Number.NaN)).toBeNull();
  });
});

describe("quoteFreshness", () => {
  test("NEGATIVE CONTROL: a minutes-old quote in a regular session is CURRENT", () => {
    expect(quoteFreshness(quote(), NOW)).toBe("CURRENT");
  });
  test("no as-of is UNKNOWN — never assumed fresh", () => {
    expect(quoteFreshness(quote({ quoteAsOf: null }), NOW)).toBe("UNKNOWN");
  });
  test("a future-stamped quote is UNKNOWN, not the freshest possible", () => {
    expect(quoteFreshness(quote({ quoteAsOf: hoursAgo(-1) }), NOW)).toBe("UNKNOWN");
  });
  test("an unusable price is UNAVAILABLE before anything else is considered", () => {
    expect(quoteFreshness(quote({ price: Number.NaN }), NOW)).toBe("UNAVAILABLE");
  });
  test("in a regular session, older than the live policy is STALE", () => {
    expect(quoteFreshness(quote({ quoteAsOf: hoursAgo(0.9) }), NOW)).toBe("CURRENT");
    expect(quoteFreshness(quote({ quoteAsOf: hoursAgo(1.1) }), NOW)).toBe("STALE");
  });
  test("a stated delay is DELAYED, with the wider policy", () => {
    expect(quoteFreshness(quote({ delaySeconds: 900 }), NOW)).toBe("DELAYED");
    expect(quoteFreshness(quote({ delaySeconds: 900, quoteAsOf: hoursAgo(3) }), NOW)).toBe("DELAYED");
    expect(quoteFreshness(quote({ delaySeconds: 900, quoteAsOf: hoursAgo(5) }), NOW)).toBe("STALE");
  });
  test("outside a session, the last close is CURRENT across a weekend", () => {
    // Sunday morning, Friday's close: ~65 hours.
    expect(quoteFreshness(quote({ session: "closed", quoteAsOf: hoursAgo(65) }), NOW)).toBe("CURRENT");
    expect(quoteFreshness(quote({ session: "post", quoteAsOf: hoursAgo(2) }), NOW)).toBe("CURRENT");
    expect(quoteFreshness(quote({ session: "pre", quoteAsOf: hoursAgo(17) }), NOW)).toBe("CURRENT");
  });
  test("outside a session, older than the longest closure is STALE", () => {
    expect(quoteFreshness(quote({ session: "closed", quoteAsOf: hoursAgo(MARKET_CLOSED_WINDOW_HOURS + 1) }), NOW)).toBe("STALE");
  });
  test("an unknown session takes the STRICT rule", () => {
    expect(quoteFreshness(quote({ session: null, quoteAsOf: hoursAgo(0.5) }), NOW)).toBe("CURRENT");
    expect(quoteFreshness(quote({ session: null, quoteAsOf: hoursAgo(2) }), NOW)).toBe("STALE");
  });
});

describe("quoteCaption", () => {
  test("NEGATIVE CONTROL: current says nothing", () => {
    expect(quoteCaption(quote(), NOW)).toBeNull();
  });
  test("every other state is said", () => {
    expect(quoteCaption(quote({ quoteAsOf: hoursAgo(30) }), NOW)).toContain("stale quote (as of 2026-09-16)");
    expect(quoteCaption(quote({ quoteAsOf: null }), NOW)).toBe("quote age not known");
    expect(quoteCaption(quote({ delaySeconds: 900 }), NOW)).toContain("delayed quote");
    expect(quoteCaption(quote({ price: Number.NaN }), NOW)).toBe("no quote");
  });
});

describe("quoteBanner", () => {
  test("NEGATIVE CONTROL: no quotes, no banner", () => {
    expect(quoteBanner(undefined, NOW)).toBeNull();
    expect(quoteBanner({}, NOW)).toBeNull();
  });
  test("names the provider, the session, the unstated delay, and counts the not-current", () => {
    const b = quoteBanner({ AAA: quote(), BBB: quote({ quoteAsOf: null }), CCC: quote({ quoteAsOf: hoursAgo(5) }) }, NOW)!;
    expect(b).toContain("Quotes from Yahoo");
    expect(b).toContain("regular session");
    expect(b).toContain("delay not stated by the provider");
    expect(b).toContain("2 of 3 are not current");
  });
  test("all current: no count", () => {
    expect(quoteBanner({ AAA: quote(), BBB: quote() }, NOW)).not.toContain("not current");
  });
  test("mixed sessions are not summarised as one", () => {
    expect(quoteBanner({ AAA: quote(), BBB: quote({ session: "closed" }) }, NOW)).toContain("session not stated");
  });
  test("a stated common delay is said in minutes", () => {
    expect(quoteBanner({ AAA: quote({ delaySeconds: 900 }) }, NOW)).toContain("15 min delayed");
  });
});

describe("exchangeZoneOf", () => {
  test("a zone the runtime knows passes through unchanged", () => {
    expect(exchangeZoneOf("America/New_York")).toBe("America/New_York");
    expect(exchangeZoneOf("Asia/Tokyo")).toBe("Asia/Tokyo");
  });
  test("anything else is null, never a default zone", () => {
    expect(exchangeZoneOf("Mars/Olympus")).toBeNull();
    expect(exchangeZoneOf("")).toBeNull();
    expect(exchangeZoneOf(undefined)).toBeNull();
    expect(exchangeZoneOf(42)).toBeNull();
    // Negative control: the output is never invented from a bad input.
    expect(exchangeZoneOf("Mars/Olympus")).not.toBe("America/New_York");
  });
});
