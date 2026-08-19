#!/usr/bin/env node
// Backfill historical daily closes into public.price_history from Stooq (free,
// no API key — OD-002). Run locally; it writes with the Supabase service-role
// key, so it must NEVER be committed and NEVER run in the browser.
//
// Usage:
//   SUPABASE_URL=... \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   BACKFILL_USER_ID=<auth.users.id> \
//   node scripts/backfill-price-history.mjs AAPL MSFT NVDA [--days 400]
//
// Symbols are US equities/ETFs (mapped to Stooq's `<sym>.us`). Indices/crypto
// are out of scope for the backfill. Idempotent: upserts on (user_id,symbol,date).
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BACKFILL_USER_ID } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !BACKFILL_USER_ID) {
  console.error(
    "Missing env. Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BACKFILL_USER_ID.",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const daysIdx = args.indexOf("--days");
const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) : 400;
const symbols = args.filter((a, i) => !a.startsWith("--") && i !== daysIdx + 1);
if (symbols.length === 0) {
  console.error(
    "Provide at least one symbol, e.g. `node scripts/backfill-price-history.mjs AAPL MSFT`.",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/** Fetch daily OHLCV from Stooq and return rows since the cutoff date. */
async function fetchStooqDaily(symbol) {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol.toLowerCase())}.us&i=d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Stooq HTTP ${res.status} for ${symbol}`);
  const text = await res.text();
  // Header: Date,Open,High,Low,Close,Volume
  const lines = text.trim().split("\n").slice(1);
  const rows = [];
  for (const line of lines) {
    const [date, , , , close, volume] = line.split(",");
    if (!date || date < cutoff) continue;
    const c = Number(close);
    if (!Number.isFinite(c)) continue;
    rows.push({
      user_id: BACKFILL_USER_ID,
      symbol: symbol.toUpperCase(),
      date,
      close: c,
      volume: Number.isFinite(Number(volume)) ? Number(volume) : null,
      source: "stooq",
    });
  }
  return rows;
}

let total = 0;
for (const symbol of symbols) {
  try {
    const rows = await fetchStooqDaily(symbol);
    if (rows.length === 0) {
      console.warn(`${symbol}: no rows since ${cutoff} (unknown symbol?)`);
      continue;
    }
    const { error } = await supabase
      .from("price_history")
      .upsert(rows, { onConflict: "user_id,symbol,date" });
    if (error) {
      console.error(`${symbol}: upsert failed — ${error.message}`);
      continue;
    }
    total += rows.length;
    console.log(`${symbol}: ${rows.length} days`);
  } catch (e) {
    console.error(`${symbol}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
console.log(`Done. Upserted ${total} rows across ${symbols.length} symbol(s).`);
