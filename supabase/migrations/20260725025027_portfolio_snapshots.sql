-- Daily portfolio snapshots for the progress-over-time chart.
CREATE TABLE IF NOT EXISTS public.portfolio_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'amir', -- amir | family
  gross NUMERIC NOT NULL DEFAULT 0,
  net NUMERIC NOT NULL DEFAULT 0,
  margin_used NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.portfolio_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "snapshots_own_rows" ON public.portfolio_snapshots
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.portfolio_snapshots TO authenticated;

CREATE INDEX IF NOT EXISTS idx_snapshots_user_time
  ON public.portfolio_snapshots(user_id, scope, created_at);
