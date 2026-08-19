# scripts/

Local operator tools. Not part of the app bundle.

## backfill-price-history.mjs

Backfills historical daily closes into `public.price_history` from **Stooq** (free,
no API key — OD-002). Run it once after the `price_history` migration is applied, to
seed history for held symbols (the app captures new daily closes automatically from
then on).

It writes with the Supabase **service-role key**, so run it **locally only** and
**never commit the key**.

```bash
SUPABASE_URL="https://<project>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
BACKFILL_USER_ID="<your auth.users id>" \
node scripts/backfill-price-history.mjs AAPL MSFT NVDA --days 400
```

- Symbols are US equities/ETFs (mapped to Stooq's `<sym>.us`).
- Idempotent: re-running upserts on `(user_id, symbol, date)`.
- `--days` (default 400) limits how far back to load.

Find `BACKFILL_USER_ID` in Supabase → Authentication → Users (the user's UUID).
