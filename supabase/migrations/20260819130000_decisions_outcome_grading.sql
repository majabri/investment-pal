-- Outcome grading (the Learning Engine) — ADDITIVE ONLY, all nullable.
-- Captures the symbol price at recommendation time, then grades each decision at
-- 1d / 1w / 1m against the subsequent price move (from price_history). Measurement
-- only — no sizing or order logic. Existing rows and flows are untouched.
ALTER TABLE public.decisions
  ADD COLUMN IF NOT EXISTS price_at_rec NUMERIC,  -- symbol price when the recommendation was logged
  ADD COLUMN IF NOT EXISTS outcome_1d   NUMERIC,  -- fractional return vs price_at_rec ~1 day later
  ADD COLUMN IF NOT EXISTS outcome_1w   NUMERIC,  -- ~1 week later
  ADD COLUMN IF NOT EXISTS outcome_1m   NUMERIC,  -- ~1 month later
  ADD COLUMN IF NOT EXISTS grade        TEXT;     -- CORRECT | WRONG | NEUTRAL | PENDING (direction-aware)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'decisions_grade_values') THEN
    ALTER TABLE public.decisions
      ADD CONSTRAINT decisions_grade_values
      CHECK (grade IS NULL OR grade IN ('CORRECT', 'WRONG', 'NEUTRAL', 'PENDING'));
  END IF;
END $$;
