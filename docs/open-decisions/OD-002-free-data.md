# OD-002 — Free data sources only

- **Status:** Approved
- **Raised:** 2026-08-14 · **Reaffirmed:** 2026-08-17
- **Area:** data integrity / scope

## Context

The app needs historical and daily price data for the price-history foundation, swing
scores, outcome grading, and buy-back zones. Paid market-data vendors add cost and a
procurement decision that isn't warranted yet.

## Decision (approved)

Phase-1 data is **free sources only**, behind the app's existing provider abstraction
(`src/lib/market.ts` — Yahoo public chart endpoint; Stooq for daily-close backfill).
Paid data is a **Phase-2 gate** with its own ADR and sign-off.

## Notes

- Keep providers behind the existing seam so a future swap is localized.
- Never commit API keys; if a provider ever needs one, it goes in untracked env with a
  committed example.
