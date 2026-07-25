-- Top 100 Investment Universe (constitution Phase 6: schema now, UI later).
CREATE TABLE IF NOT EXISTS public.investment_universe (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  company_name TEXT,
  tier TEXT NOT NULL DEFAULT 'top100', -- top100 | top25 | bench
  replaces_symbol TEXT,                -- opportunity replacement matrix
  business_quality SMALLINT,           -- all scores 1-10
  growth SMALLINT,
  valuation SMALLINT,
  technical_strength SMALLINT,
  relative_strength SMALLINT,
  catalysts TEXT,
  macro_sensitivity SMALLINT,
  geopolitical_exposure SMALLINT,
  risk SMALLINT,
  overall_conviction SMALLINT,
  thesis TEXT,
  last_scored_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, symbol)
);
ALTER TABLE public.investment_universe ENABLE ROW LEVEL SECURITY;
CREATE POLICY "universe_own_rows" ON public.investment_universe
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.investment_universe TO authenticated;
CREATE INDEX IF NOT EXISTS idx_universe_user_tier ON public.investment_universe(user_id, tier, overall_conviction);
