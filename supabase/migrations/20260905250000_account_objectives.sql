-- Goals are data (Phase 4, rule 20).
--
-- `src/lib/data/familyPolicy.ts` carries one household's objective as
-- constants: $200,000 per child, $600,000 for the family, a 2036-07-01 horizon
-- and $100 every 14 days from a fixed anchor. Those numbers reach the screen as
-- progress bars, a "Behind / On Track / Ahead" verdict and a required CAGR, and
-- they reach a model inside the committee prompt as the user's own objective.
--
-- Rule 20: "No hardcoded values anywhere, including prompt templates." A second
-- user of this app is told they are behind on a target they never set.
--
-- `accounts` already carries `starting_value`, `target_value` and
-- `target_date`. Nothing wrote them — the Settings editor deliberately skipped
-- them because nothing read them — so this migration adds only what is missing,
-- the contribution plan, and the app starts reading all of it.
--
-- NOTHING IS BACKFILLED. Every column below is NULL for every existing row, and
-- the screens say "not set" rather than showing a target nobody entered. That
-- is the same call as the household table: a default target is exactly the
-- defect being removed, and rule 15 forbids a default that masquerades as a
-- user's preference.
--
-- Money-adjacent under OD-001: these figures feed required CAGR and the
-- committee mandate. The ARITHMETIC is unchanged — this migration moves where
-- the inputs come from, from a constant in source to a column the account
-- holder fills in. Merged under the master brief's standing instruction to
-- self-merge on a green gate; called out here so it is not merged silently.
ALTER TABLE public.accounts
  -- NULL = no contribution plan stated, which is different from a plan of $0.
  -- A projection with no contributions is a real projection; a projection that
  -- ASSUMES no contributions because nobody was asked is a guess.
  ADD COLUMN IF NOT EXISTS contribution_amount       NUMERIC,
  ADD COLUMN IF NOT EXISTS contribution_cadence_days INTEGER,
  ADD COLUMN IF NOT EXISTS contribution_anchor_date  DATE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_contribution_bounds') THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_contribution_bounds
      CHECK (
        (contribution_amount IS NULL OR contribution_amount >= 0)
        -- A cadence of 0 days is an infinite loop in every "next contribution"
        -- calculation, and a negative one walks backwards through time.
        AND (contribution_cadence_days IS NULL OR contribution_cadence_days > 0)
      );
  END IF;
END $$;

COMMENT ON COLUMN public.accounts.target_value IS
  'The objective for this account. NULL = not set, never a default (rule 15, rule 20). Read by /kids and the committee prompt as of Phase 4.';
COMMENT ON COLUMN public.accounts.target_date IS
  'The horizon for target_value. NULL = not set. A missing horizon must not become today: a CAGR against the epoch is a confident, enormous, wrong number.';
COMMENT ON COLUMN public.accounts.contribution_amount IS
  'Recurring contribution in the account currency. NULL = no plan stated, which is not a plan of zero.';
COMMENT ON COLUMN public.accounts.contribution_cadence_days IS
  'Days between contributions. NULL = no plan stated. Must be > 0.';
COMMENT ON COLUMN public.accounts.contribution_anchor_date IS
  'A date a contribution is known to fall on; the schedule is derived from it and the cadence. NULL = no plan stated.';
