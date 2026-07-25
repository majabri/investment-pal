-- Continuous learning: recommendation → decision → outcome tracking.
CREATE TABLE IF NOT EXISTS public.decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  review_type TEXT NOT NULL DEFAULT 'morning', -- morning | midday | eod | weekly
  symbol TEXT,
  recommendation TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT 'pending', -- followed | modified | rejected | pending
  outcome TEXT,
  outcome_pl NUMERIC,
  decided_on DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "decisions_own_rows" ON public.decisions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.decisions TO authenticated;
CREATE INDEX IF NOT EXISTS idx_decisions_user_date ON public.decisions(user_id, decided_on);
