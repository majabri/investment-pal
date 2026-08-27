// Live calendars (keyless, Nasdaq public API) with 1-hour server cache and
// graceful fallback to the seed data if the source is unreachable.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ECON_EVENTS, EARNINGS_EVENTS, type EconEvent, type EarningsEvt } from "./data/calendars";
import { economicCalendarInputSchema, earningsCalendarInputSchema } from "./serverInput";
import { enforceProviderRateLimit } from "./serverRateLimit";

const HDRS = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };
const cache = new Map<string, { at: number; data: unknown }>();
const HOUR = 60 * 60 * 1000;

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < HOUR) return hit.data as T;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}

function nextDays(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

export interface LiveEarnings extends EarningsEvt {
  source: "live" | "seed";
  companyName?: string;
}
export interface LiveEcon extends EconEvent {
  source: "live" | "seed";
  country?: string;
  time?: string;
  actual?: string;
  consensus?: string;
}

/** Earnings for the next `days`, filtered to the given symbols (or all US majors). */
export const getEarningsCalendarFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => earningsCalendarInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<LiveEarnings[]> => {
    await enforceProviderRateLimit(context.supabase, "calendar");
    const want = new Set(data.symbols.map((s) => s.toUpperCase()));
    const days = Math.min(data.days ?? 14, 21);
    try {
      const all = await cached(`earn:${days}`, async () => {
        const out: { date: string; symbol: string; time: string; name: string }[] = [];
        for (const date of nextDays(days)) {
          const res = await fetch(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, {
            headers: HDRS,
          });
          if (!res.ok) continue;
          const j = await res.json();
          for (const r of j?.data?.rows ?? []) {
            out.push({
              date,
              symbol: String(r.symbol ?? "").toUpperCase(),
              time: String(r.time ?? ""),
              name: String(r.companyName ?? ""),
            });
          }
        }
        return out;
      });
      const mine = all.filter((r) => want.has(r.symbol));
      if (!mine.length && !all.length) throw new Error("empty");
      return mine.map((r) => ({
        date: r.date,
        symbol: r.symbol,
        session: r.time.includes("pre") ? ("bmo" as const) : ("amc" as const),
        inPortfolio: true,
        source: "live" as const,
        companyName: r.name,
      }));
    } catch {
      const t = new Date().toISOString().slice(0, 10);
      return EARNINGS_EVENTS.filter((e) => e.date >= t && want.has(e.symbol)).map((e) => ({
        ...e,
        source: "seed" as const,
      }));
    }
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
    try {
      const rows = await cached(`econ:${days}`, async () => {
        const out: LiveEcon[] = [];
        for (const date of nextDays(days)) {
          const res = await fetch(
            `https://api.nasdaq.com/api/calendar/economicevents?date=${date}`,
            { headers: HDRS },
          );
          if (!res.ok) continue;
          const j = await res.json();
          for (const r of j?.data?.rows ?? []) {
            if (String(r.country ?? "") !== "United States") continue;
            const name = String(r.eventName ?? "");
            out.push({
              date,
              name,
              importance: HIGH.test(name) ? "high" : MED.test(name) ? "medium" : "low",
              source: "live",
              country: "US",
              time: String(r.gmt ?? ""),
              actual: String(r.actual ?? ""),
              consensus: String(r.consensus ?? ""),
            });
          }
        }
        return out;
      });
      if (!rows.length) throw new Error("empty");
      return rows;
    } catch {
      const t = new Date().toISOString().slice(0, 10);
      return ECON_EVENTS.filter((e) => e.date >= t).map((e) => ({ ...e, source: "seed" as const }));
    }
  });
