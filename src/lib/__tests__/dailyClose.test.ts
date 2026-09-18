// The daily close is a close (OBS-001; §B.2; DATA-002).
import { describe, expect, test } from "bun:test";

import {
  EMPTY_BATCH,
  SKIP_LABEL,
  closeBatchKey,
  closeCoverage,
  closeNotice,
  closeOf,
  dailyCloseRows,
  exchangeDate,
  expectedCloseDate,
} from "@/lib/dailyClose";
import type { CloseBatch } from "@/lib/dailyClose";
import type { ProvenancedQuote } from "@/lib/quoteProvenance";

// New York regular session on Thursday 2026-09-17 ends 16:00 ET = 20:00Z.
const NY_CLOSE = "2026-09-17T20:00:00Z";
const NY = "America/New_York";

const quote = (over: Partial<ProvenancedQuote> = {}): ProvenancedQuote => ({
  price: 100,
  prevClose: 99,
  changePct: 1.01,
  provider: "yahoo",
  quoteAsOf: NY_CLOSE,
  retrievedAt: "2026-09-17T21:00:00Z",
  session: "post",
  delaySeconds: null,
  exchangeTimezone: NY,
  ...over,
});

describe("exchangeDate", () => {
  test("is the exchange's calendar date, not the UTC one", () => {
    // 23:30Z on the 17th is already the 18th in Tokyo and still the 17th in New York.
    const at = "2026-09-17T23:30:00Z";
    expect(exchangeDate(at, "Asia/Tokyo")).toBe("2026-09-18");
    expect(exchangeDate(at, NY)).toBe("2026-09-17");
    // Negative control: the two are not the same string.
    expect(exchangeDate(at, "Asia/Tokyo")).not.toBe(exchangeDate(at, NY));
  });
  test("west of Greenwich in the evening the UTC date is tomorrow; the exchange date is today", () => {
    // 02:00Z on the 18th is 22:00 ET on the 17th.
    expect(exchangeDate("2026-09-18T02:00:00Z", NY)).toBe("2026-09-17");
    expect("2026-09-18T02:00:00Z".slice(0, 10)).toBe("2026-09-18"); // the wrong answer this guards against
  });
  test("an unknown zone or an unparseable instant is null, never a guess", () => {
    expect(exchangeDate(NY_CLOSE, "Mars/Olympus")).toBeNull();
    expect(exchangeDate("not a date", NY)).toBeNull();
  });
});

describe("closeOf", () => {
  test("after the regular session the quote is that day's close, dated by the exchange", () => {
    expect(closeOf(quote({ session: "post" }))).toEqual({ kind: "close", date: "2026-09-17", close: 100 });
    expect(closeOf(quote({ session: "closed", retrievedAt: "2026-09-20T15:00:00Z" }))).toEqual({
      kind: "close",
      date: "2026-09-17",
      close: 100,
    });
  });
  test("the next morning's pre-session quote is still YESTERDAY's close — the quote's own date, not today's", () => {
    const v = closeOf(quote({ session: "pre", retrievedAt: "2026-09-18T12:00:00Z" }));
    expect(v).toEqual({ kind: "close", date: "2026-09-17", close: 100 });
  });
  test("a quote during the regular session is a print, not a close, however it is stamped", () => {
    expect(closeOf(quote({ session: "regular", quoteAsOf: "2026-09-17T14:15:00Z" }))).toEqual({
      kind: "skipped",
      reason: "intraday",
    });
    // Negative control: the same quote after the bell IS a close.
    expect(closeOf(quote({ session: "post", quoteAsOf: "2026-09-17T14:15:00Z" })).kind).toBe("close");
  });
  test("no session known is skipped — a close cannot be told from a print", () => {
    expect(closeOf(quote({ session: null }))).toEqual({ kind: "skipped", reason: "session_unknown" });
  });
  test("no time-stamp is skipped, never dated by the clock on the wall", () => {
    expect(closeOf(quote({ quoteAsOf: null }))).toEqual({ kind: "skipped", reason: "no_as_of" });
    expect(closeOf(quote({ quoteAsOf: "garbage" }))).toEqual({ kind: "skipped", reason: "no_as_of" });
  });
  test("no exchange zone is skipped — the date would be a guess", () => {
    expect(closeOf(quote({ exchangeTimezone: null }))).toEqual({ kind: "skipped", reason: "no_exchange_zone" });
  });
  test("an unusable price is skipped first", () => {
    expect(closeOf(quote({ price: NaN }))).toEqual({ kind: "skipped", reason: "no_price" });
    expect(closeOf(quote({ price: 0 }))).toEqual({ kind: "skipped", reason: "no_price" });
    expect(closeOf(quote({ price: -1, quoteAsOf: null }))).toEqual({ kind: "skipped", reason: "no_price" });
  });
  test("the date follows the exchange: a Tokyo close stamped after Greenwich midnight is the next day", () => {
    // Tokyo closes 15:00 JST = 06:00Z; but suppose the stamp lands at 23:30Z on the 17th.
    const v = closeOf(quote({ exchangeTimezone: "Asia/Tokyo", quoteAsOf: "2026-09-17T23:30:00Z" }));
    expect(v).toEqual({ kind: "close", date: "2026-09-18", close: 100 });
    const ny = closeOf(quote({ exchangeTimezone: NY, quoteAsOf: "2026-09-17T23:30:00Z" }));
    expect(ny).toEqual({ kind: "close", date: "2026-09-17", close: 100 });
  });
});

describe("dailyCloseRows", () => {
  test("keeps the closes, sorted by symbol, and counts every skip with its reason", () => {
    const batch = dailyCloseRows({
      ZZZ: quote({ price: 20 }),
      AAA: quote({ price: 10 }),
      MMM: quote({ session: "regular" }),
      QQQ: quote({ quoteAsOf: null }),
    });
    expect(batch.rows).toEqual([
      { symbol: "AAA", date: "2026-09-17", close: 10, source: "yahoo" },
      { symbol: "ZZZ", date: "2026-09-17", close: 20, source: "yahoo" },
    ]);
    expect(batch.skipped).toEqual([
      { symbol: "MMM", reason: "intraday" },
      { symbol: "QQQ", reason: "no_as_of" },
    ]);
    // Negative control: rows + skipped account for every quote; nothing is dropped.
    expect(batch.rows.length + batch.skipped.length).toBe(4);
  });
  test("no quotes is the empty batch", () => {
    expect(dailyCloseRows(undefined)).toEqual(EMPTY_BATCH);
    expect(dailyCloseRows({})).toEqual({ rows: [], skipped: [] });
  });
});

describe("closeBatchKey / expectedCloseDate", () => {
  const rows = dailyCloseRows({ AAA: quote(), BBB: quote() }).rows;
  test("same closes, same key, whatever the order", () => {
    expect(closeBatchKey(rows)).toBe(closeBatchKey([...rows].reverse()));
  });
  test("a new trading day is a new key", () => {
    const next = dailyCloseRows({ AAA: quote({ quoteAsOf: "2026-09-18T20:00:00Z" }), BBB: quote({ quoteAsOf: "2026-09-18T20:00:00Z" }) }).rows;
    expect(closeBatchKey(next)).not.toBe(closeBatchKey(rows));
  });
  test("a changed price on the same day is NOT a new key (the upsert refreshes; the day is the identity)", () => {
    const again = dailyCloseRows({ AAA: quote({ price: 101 }), BBB: quote() }).rows;
    expect(closeBatchKey(again)).toBe(closeBatchKey(rows));
  });
  test("the expected date is the latest close date in the batch, null when there is none", () => {
    expect(expectedCloseDate({ rows, skipped: [] })).toBe("2026-09-17");
    const mixed = dailyCloseRows({ AAA: quote(), BBB: quote({ quoteAsOf: "2026-09-18T20:00:00Z" }) });
    expect(expectedCloseDate(mixed)).toBe("2026-09-18");
    expect(expectedCloseDate(EMPTY_BATCH)).toBeNull();
    expect(expectedCloseDate(dailyCloseRows({ AAA: quote({ session: "regular" }) }))).toBeNull();
  });
});

describe("closeCoverage", () => {
  const history = [
    { symbol: "AAA", date: "2026-09-15" },
    { symbol: "AAA", date: "2026-09-17" },
    { symbol: "BBB", date: "2026-09-15" },
    { symbol: "CCC", date: "2026-09-18" }, // a backfill ahead of the quotes
  ];
  test("current, behind, none — each symbol lands in exactly one bucket", () => {
    const cov = closeCoverage(history, ["AAA", "BBB", "CCC", "DDD"], "2026-09-17");
    expect(cov.current).toEqual(["AAA", "CCC"]);
    expect(cov.behind).toEqual([{ symbol: "BBB", last: "2026-09-15" }]);
    expect(cov.none).toEqual(["DDD"]);
    expect(cov.undetermined).toEqual([]);
    expect(cov.current.length + cov.behind.length + cov.none.length + cov.undetermined.length).toBe(4);
  });
  test("a missing day is a gap: the previous close is never carried forward to cover it", () => {
    const cov = closeCoverage(history, ["BBB"], "2026-09-17");
    expect(cov.behind).toEqual([{ symbol: "BBB", last: "2026-09-15" }]);
    expect(cov.current).not.toContain("BBB");
  });
  test("with no expected date, symbols with history are undetermined, not current", () => {
    const cov = closeCoverage(history, ["AAA", "DDD"], null);
    expect(cov.undetermined).toEqual(["AAA"]);
    expect(cov.none).toEqual(["DDD"]);
    expect(cov.current).toEqual([]);
  });
  test("duplicate symbols are counted once; history for unheld symbols is ignored", () => {
    const cov = closeCoverage(history, ["AAA", "AAA"], "2026-09-17");
    expect(cov.current).toEqual(["AAA"]);
    expect(cov.none).toEqual([]);
  });
});

describe("closeNotice", () => {
  const closed = (symbols: string[]): CloseBatch => dailyCloseRows(Object.fromEntries(symbols.map((s) => [s, quote()])));
  const intraday = (symbols: string[]): CloseBatch =>
    dailyCloseRows(Object.fromEntries(symbols.map((s) => [s, quote({ session: "regular" })])));
  const hist = (pairs: [string, string][]) => pairs.map(([symbol, date]) => ({ symbol, date }));

  test("nothing held, nothing to say", () => {
    expect(closeNotice(closeCoverage([], [], null), EMPTY_BATCH)).toBeNull();
  });
  test("all current says so and names the date", () => {
    const cov = closeCoverage(hist([["AAA", "2026-09-17"], ["BBB", "2026-09-17"]]), ["AAA", "BBB"], "2026-09-17");
    expect(closeNotice(cov, closed(["AAA", "BBB"]))).toBe("Daily closes through 2026-09-17: all 2 held symbols recorded.");
  });
  test("behind and missing are counted, with the oldest last close; never 'all'", () => {
    const cov = closeCoverage(
      hist([["AAA", "2026-09-17"], ["BBB", "2026-09-15"], ["CCC", "2026-09-10"]]),
      ["AAA", "BBB", "CCC", "DDD"],
      "2026-09-17",
    );
    const line = closeNotice(cov, closed(["AAA", "BBB", "CCC", "DDD"]))!;
    expect(line).toBe(
      "Daily closes through 2026-09-17: 1 of 4 held symbols recorded; 2 behind (oldest last close 2026-09-10); 1 with no history.",
    );
    expect(line).not.toContain("all ");
  });
  test("mid-session: says what is stored and that the latest close cannot yet be judged; says why nothing is recorded", () => {
    const cov = closeCoverage(hist([["AAA", "2026-09-16"]]), ["AAA", "BBB"], null);
    expect(closeNotice(cov, intraday(["AAA", "BBB"]))).toBe(
      "Daily closes: 1 of 2 held symbols has stored history, 1 with none; whether the latest close is recorded cannot be told until a close is quoted. Not recording now: the session is in progress.",
    );
  });
  test("mixed skip reasons are each named with a count, most common first", () => {
    const batch = dailyCloseRows({
      AAA: quote({ session: "regular" }),
      BBB: quote({ session: "regular" }),
      CCC: quote({ quoteAsOf: null }),
    });
    const cov = closeCoverage([], ["AAA", "BBB", "CCC"], null);
    expect(closeNotice(cov, batch)).toContain(
      `Not recording now: ${SKIP_LABEL.intraday} (2); ${SKIP_LABEL.no_as_of} (1).`,
    );
  });
  test("when some closes ARE being recorded, no 'not recording' clause is added", () => {
    const batch = dailyCloseRows({ AAA: quote(), BBB: quote({ session: "regular" }) });
    const cov = closeCoverage(hist([["AAA", "2026-09-17"]]), ["AAA", "BBB"], expectedCloseDate(batch));
    const line = closeNotice(cov, batch)!;
    expect(line).toBe("Daily closes through 2026-09-17: 1 of 2 held symbols recorded; 1 with no history.");
    expect(line).not.toContain("Not recording");
  });
  test("every skip reason has a label", () => {
    for (const r of ["no_price", "no_as_of", "session_unknown", "intraday", "no_exchange_zone"] as const) {
      expect(SKIP_LABEL[r].length).toBeGreaterThan(0);
    }
  });
});
