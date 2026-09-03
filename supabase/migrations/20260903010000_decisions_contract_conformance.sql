-- Bring `public.decisions` up to the canonical InvestmentRecommendation
-- contract (ADR-APP-008; OD-008 resolved 2026-09-03 in favour of the 14-field
-- schema in `08 APIs/contracts/`, plus `objective_id` carried over from the
-- superseded 10-field version).
--
-- ADDITIVE ONLY. Every column is nullable with no default and no backfill.
-- Existing rows keep reading as "not captured", which is true: nobody recorded
-- which model, prompt or policy version produced them, and inventing a value
-- would put a fabricated provenance stamp on a governed decision.
--
-- Two contract fields are deliberately NOT renamed, and the divergence is
-- recorded in ADR-APP-008 rather than smoothed over:
--   contract `recommendation_id`     -> column `decisions.id`
--   contract `supporting_evidence`   -> column `decisions.evidence`
-- Renaming a live column that the extractor and three screens already write
-- and read buys nothing but risk; the mapping is one line in code.
ALTER TABLE public.decisions
  ADD COLUMN IF NOT EXISTS ips_version    TEXT,  -- IPS version in force when the recommendation was made
  ADD COLUMN IF NOT EXISTS model_version  TEXT,  -- model that produced it
  ADD COLUMN IF NOT EXISTS prompt_version TEXT,  -- committee prompt version that produced it
  ADD COLUMN IF NOT EXISTS objective_id   TEXT;  -- link to the IPS objective this serves

COMMENT ON COLUMN public.decisions.ips_version IS
  'IPS version in force when this recommendation was produced. NULL = not captured; never backfill.';
COMMENT ON COLUMN public.decisions.model_version IS
  'Model that produced this recommendation. NULL = not captured; never backfill.';
COMMENT ON COLUMN public.decisions.prompt_version IS
  'Committee prompt version that produced this recommendation. NULL = not captured; never backfill.';
COMMENT ON COLUMN public.decisions.objective_id IS
  'IPS objective this recommendation serves. NULL = not captured; never backfill.';

-- No CHECK constraint on `action` against the contract enum. Rows already in
-- the table use values outside it (the PR #63 migration comment itself lists
-- TRIM and MARGIN), so a constraint would either fail to apply or force a
-- rewrite of historical decisions. The enum is enforced in the UI layer, which
-- shows off-contract values as written and flags them.
