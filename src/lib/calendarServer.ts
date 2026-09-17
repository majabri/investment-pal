// Live calendars (keyless, Nasdaq public API) with a 1-hour server cache.
//
// Three outcomes, kept apart (BR-008, §15.4):
//
//   * the provider answered and there are events        → rows
//   * the provider answered and there are none           → [] (a quiet period)
//   * the provider did not answer on any day             → throw
//
// A throw reaches the client as UNAVAILABLE through `coverageOf`; an empty
// array reaches it as AVAILABLE with nothing in it. Before this, both were the
// same empty array, and a static seed file whose dates had all passed was
// offered as a "fallback" for either.
//
// LIMITATION, stated rather than hidden: a period in which SOME days failed is
// returned as the rows from the days that answered. The array carries no
// coverage metadata, so a caller cannot yet tell a complete week from a
// partial one. The count is computed (`collectCalendar`) and not yet carried;
// carrying it changes seven call sites and is tracked in the gap matrix.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { collectCalendar, type DayFetch } from "./calendarCoverage";
import { nextLocalDays } from "./localDate";
import { economicCalendarInputSchema, earningsCalendarInputSchema } from "./serverInput";
import { enforceProviderRateLimit } from "./serverRateLimit";

const HDRS = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };
const cache = new Map<string, { at: number; data: unknown }>();
const HOUR = 60 * 60 * 1000;

/**
 * Cache an answer, never a non-answer. An unavailable provider is not cached
 * for an hour — the next request asks again — but a quiet period is, because
 * "nothing scheduled" is an answer.
 */
async function cachedAnswer<T>(key: string, fn: () => Promise<T[] | null>): Promise<T[] | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < HOUR) return hit.data as T[];
  const data = await fn();
  if (data !== null) cache.set(key, { at: Date.now(), data });
  return data;
}

export interface EconEvent {
  date: string;
  name: string;
  importance: "high" | "medium" | "low";
}
export interface EarningsEvt {
  date: string;
  symbol: string;
  session: "bmo" | "amc";
  inPortfolio?: boolean;
  onWatchlist?: boolean;
}

export interface LiveEarnings extends EarningsEvt {
  source: "live";
  companyName?: string;
}
export interface LiveEcon extends EconEvent {
  source: "live";
  country?: string;
  time?: string;
  actual?: string;
  consensus?: string;
}

/** One day's request against the provider, never throwing: a failure is a fact to count. */
async function fetchDay<T>(url: string, parse: (json: unknown) => T[]): Promise<DayFetch<T>> {
  try {
    const res = await fetch(url, { headers: HDRS });
    if (!res.ok) return { ok: false };
    return { ok: true, rows: parse(await res.json()) };
  } catch {
    return { ok: false };
  }
}

const rowsOf = (json: unknown): Record<string, unknown>[] => {
  const rows = (json as { data?: { rows?: unknown } } | null)?.data?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
};

/** Earnings for the next `days`, filtered to the given symbols (or all US majors). */
export const getEarningsCalendarFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => earningsCalendarInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<LiveEarnings[]> => {
    await enforceProviderRateLimit(context.supabase, "calendar");
    const want = new Set(data.symbols.map((s) => s.toUpperCase()));
    const days = Math.min(data.days ?? 14, 21);
    type Raw = { date: string; symbol: string; time: string; name: string };
    const all = await cachedAnswer<Raw>(`earn:${days}`, async () => {
      const fetched: DayFetch<Raw>[] = [];
      for (const date of nextLocalDays(days)) {
        fetched.push(
          await fetchDay(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, (j) =>
            rowsOf(j).map((r) => ({
              date,
              symbol: String(r.symbol ?? "").toUpperCase(),
              time: String(r.time ?? ""),
              name: String(r.companyName ?? ""),
            })),
          ),
        );
      }
      const outcome = collectCalendar(fetched);
      return outcome.kind === "rows" ? outcome.rows : null;
    });
    if (all === null) {
      // Not "empty". No day answered, so nothing is known about the period.
      throw new Error(`Earnings calendar unavailable: the provider did not answer for any of the next ${days} days.`);
    }
    // A quiet period for these symbols is `[]`, and it is an answer.
    return all
      .filter((r) => want.has(r.symbol))
      .map((r) => ({
        date: r.date,
        symbol: r.symbol,
        session: r.time.includes("pre") ? ("bmo" as const) : ("amc" as const),
        inPortfolio: true,
        source: "live" as const,
        companyName: r.name,
      }));
  });

const HIGH =
  /fomc|fed |federal reserve|cpi|core pce|nonfarm|payroll|gdp|rate decision|unemployment/i;
const MED = /ppi|retail sales|ism|pmi|consumer confidence|housing|jobless|durable/i;

/** US economic events for the next `days`. */
export const getEconCalendarFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => economicCalendarInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<LiveEcon[]> => {
    await enforceProviderRateLimit(context.supabase, "calendar");
    const days = Math.min(data.days ?? 10, 21);
    const rows = await cachedAnswer<LiveEcon>(`econ:${days}`, async () => {
      const fetched: DayFetch<LiveEcon>[] = [];
      for (const date of nextLocalDays(days)) {
        fetched.push(
          await fetchDay(`https://api.nasdaq.com/api/calendar/economicevents?date=${date}`, (j) =>
            rowsOf(j)
              .filter((r) => String(r.country ?? "") === "United States")
              .map((r) => {
                const name = String(r.eventName ?? "");
                return {
                  date,
                  name,
                  importance: HIGH.test(name) ? "high" : MED.test(name) ? "medium" : "low",
                  source: "live" as const,
                  country: "US",
                  time: String(r.gmt ?? ""),
                  actual: String(r.actual ?? ""),
                  consensus: String(r.consensus ?? ""),
                };
              }),
          ),
        );
      }
      const outcome = collectCalendar(fetched);
      return outcome.kind === "rows" ? outcome.rows : null;
    });
    if (rows === null) {
      throw new Error(`Economic calendar unavailable: the provider did not answer for any of the next ${days} days.`);
    }
    // No US events in the window is `[]`, and it is an answer.
    return rows;
  });
