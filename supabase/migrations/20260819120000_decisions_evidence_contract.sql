-- Evidence contract on decisions — ADDITIVE ONLY.
-- All columns are nullable; existing rows and the current Action Sheet flow are
-- untouched (populating these columns from the extractor is a separate PR).
-- Confidence and probability are kept as SEPARATE columns and never conflated
-- (ADR-APP-001 governance; the v6 committee prompt already demands these fields).
ALTER TABLE public.decisions
  ADD COLUMN IF NOT EXISTS action                  TEXT,    -- BUY | SELL | TRIM | ADD | HOLD | MARGIN | ...
  ADD COLUMN IF NOT EXISTS confidence              NUMERIC, -- 0..1 decision confidence — NOT outcome probability
  ADD COLUMN IF NOT EXISTS evidence                JSONB,   -- supporting evidence: [{ source, claim, ... }]
  ADD COLUMN IF NOT EXISTS counterargument         TEXT,    -- bear case / devil's advocate
  ADD COLUMN IF NOT EXISTS key_risks               JSONB,   -- string[]
  ADD COLUMN IF NOT EXISTS portfolio_impact        JSONB,   -- effect on exposure / allocation
  ADD COLUMN IF NOT EXISTS probability_impact      JSONB,   -- effect on objective-success probability (distinct from confidence)
  ADD COLUMN IF NOT EXISTS invalidation_conditions JSONB;   -- string[] — what would make the thesis wrong

-- Document the confidence-vs-probability distinction at the schema level.
COMMENT ON COLUMN public.decisions.confidence IS
  'Decision confidence in [0,1] (how sure the reasoning is). NOT the probability of the outcome — see probability_impact. Never conflate the two.';
COMMENT ON COLUMN public.decisions.probability_impact IS
  'Effect of this decision on the probability of achieving the objective. Distinct from confidence.';

-- Guardrail for future writes; existing (NULL) rows validate trivially.
-- ADD CONSTRAINT has no IF NOT EXISTS in Postgres, so guard for idempotent re-runs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'decisions_confidence_range'
  ) THEN
    ALTER TABLE public.decisions
      ADD CONSTRAINT decisions_confidence_range
      CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));
  END IF;
END $$;
