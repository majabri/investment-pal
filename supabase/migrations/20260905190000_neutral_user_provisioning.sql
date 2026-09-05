-- A new user must not be provisioned with someone else's objective.
--
-- P0 remediation Tier 2 (2026-09-05). `public.goals` shipped with one person's
-- profile compiled into the SCHEMA:
--
--   name           NOT NULL DEFAULT '<the owner's account name>'
--   starting_value NOT NULL DEFAULT <the owner's starting value>
--   target_value   NOT NULL DEFAULT <the owner's target>
--   target_date    NOT NULL DEFAULT <the owner's target date>
--
-- (the literals are deliberately not repeated here — the personal-data guard
-- forbids them, and it caught this comment when it did quote them)
--
-- and `handle_new_user()` inserted exactly those values for every signup. Any
-- new user landed with a stranger's account name, target and date — personal
-- profile as application logic (rules 1, 20, 27), and the reason the app could
-- not serve a second user without a code change (rule 37).
--
-- Forward migration; the applied migration is not edited (checksum safety).
--
-- Why the objective columns become NULLABLE and not merely default-less:
-- NOT NULL with no default makes an insert that omits them fail, so the trigger
-- would have to supply numbers — inventing an objective, which is the defect.
-- Rule 13 says unknown must be expressible, and an unset objective is exactly
-- that. NULL means "not set"; it must never render as $0.
--
-- Why a row is still inserted at all: there is no create-a-goal path in the UI
-- (`useGoal` exposes only `update`, and the Goal screen's save returns early
-- when there is no goal). Provisioning no row would leave a new user unable to
-- ever set an objective. The row exists and is editable; the objective in it is
-- genuinely unset. Adding a create path is Phase 4 work, and once it exists the
-- trigger can stop inserting entirely.

ALTER TABLE public.goals
  ALTER COLUMN name           SET DEFAULT 'Primary',
  ALTER COLUMN starting_value DROP DEFAULT,
  ALTER COLUMN starting_value DROP NOT NULL,
  ALTER COLUMN target_value   DROP DEFAULT,
  ALTER COLUMN target_value   DROP NOT NULL,
  ALTER COLUMN target_date    DROP DEFAULT,
  ALTER COLUMN target_date    DROP NOT NULL;

COMMENT ON COLUMN public.goals.name IS
  'Display name for the objective. Neutral default; never a person.';
COMMENT ON COLUMN public.goals.starting_value IS
  'NULL means not set. Not zero — zero is a claim that the objective starts from nothing.';
COMMENT ON COLUMN public.goals.target_value IS
  'NULL means not set. Every consumer must render it as unknown, never as $0 (rule 13).';
COMMENT ON COLUMN public.goals.target_date IS
  'NULL means not set. A missing horizon must suppress CAGR and probability, not default to one.';

-- Neutral provisioning. The row is created so the user has something to edit;
-- the objective fields are left unset for the user to fill in.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)));
  -- user_id only: name takes the neutral default, and the objective columns
  -- stay NULL. No target, no date, no starting value is invented here.
  INSERT INTO public.goals (user_id)
  VALUES (NEW.id);
  RETURN NEW;
END; $$;

-- `portfolio_snapshots.scope` defaulted to a person's name. The column is
-- already deprecated in favour of account_id (Stage 5), so this only stops the
-- default from being a person; existing rows are re-labelled rather than
-- deleted, because they are real recorded history.
ALTER TABLE public.portfolio_snapshots ALTER COLUMN scope SET DEFAULT 'primary';
UPDATE public.portfolio_snapshots SET scope = 'primary' WHERE scope = 'amir';
