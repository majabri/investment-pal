-- Price history foundation: one daily close per held symbol.
-- Feeds outcome grading, swing scores, and buy-back zones (Investment OS
-- capabilities adapted to single-user scale — see docs/adr/ADR-APP-001.md).
-- Free sources only (OD-002): live capture via the existing Yahoo quote layer;
-- historical backfill via Stooq (scripts/backfill-price-history.mjs).
CREATE TABLE IF NOT EXISTS public.price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  date DATE NOT NULL,
  close NUMERIC NOT NULL,
  volume NUMERIC,                       -- nullable: live quote layer has no volume
  source TEXT NOT NULL DEFAULT 'yahoo', -- yahoo (live capture) | stooq (backfill)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One row per user/symbol/day makes daily capture idempotent (upsert).
  UNIQUE (user_id, symbol, date)
);

ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "price_history_own_rows" ON public.price_history
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_history TO authenticated;

CREATE INDEX IF NOT EXISTS idx_price_history_user_symbol_date
  ON public.price_history(user_id, symbol, date);
