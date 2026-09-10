-- Goal versions, immutable (GOAL-001 / GOAL-002).
--
-- `goals` is one mutable row. Editing the target overwrites it, so:
--
--   * every decision recorded before the edit now cites a goal that never
--     existed when it was taken. "Buy NVDA — advances the $150,000 by
--     2027-03-31 objective" reads, after a single Settings save, as though it
--     had been taken against whatever the goal says today;
--   * a goal moved to meet the portfolio is indistinguishable from a portfolio
--     moved to meet the goal, and the second is the only one worth doing;
--   * `updated_at` records that SOMETHING changed, never what.
--
-- This table makes each saved goal a new immutable row and gives every decision
-- a pointer to the exact version it was taken under.
--
-- IMMUTABLE MEANS IMMUTABLE. There is no `updated_at` column, no UPDATE policy
-- and no DELETE policy, and the trigger below turns a privileged write into a
-- loud error rather than a silent rewrite. A version that can be edited is a
-- `goals` row with extra steps.
--
-- GOAL-003 — TWO BASELINES THAT MUST NOT MERGE
--
-- `baseline_type` says which of these the version was written against:
--
--   * `broker_equity` — what the account is actually worth, from the broker.
--     It moves every day and nobody chose it.
--   * `manual_plan` — a planning figure the holder entered. It moves when they
--     decide it does.
--
-- Blending them produces a required return computed from a number that is
-- neither, which is the failure GOAL-003 names. They are one column with two
-- values rather than two nullable columns for exactly that reason: a row cannot
-- carry both and leave the reader to guess.
--
-- TARGET VALUE AND TARGET RETURN
--
-- Both columns exist because the holder may think in either. They are NOT
-- reconciled here: a CHECK cannot see the contribution plan or the horizon, and
-- silently deriving one from the other is precisely what the brief forbids. The
-- linkage, and the refusal to pick a winner when the two conflict, is in
-- `src/lib/goalVersion.ts` and its tests.
--
-- Money-adjacent under OD-001 in the sense that a target return is a rate. No
-- arithmetic here changes any existing figure: this migration adds a table, one
-- nullable column on `decisions`, and nothing reads either until the
-- accompanying code does. `goals` is untouched and remains the current goal.
CREATE TABLE IF NOT EXISTS public.goal_versions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  goal_id          UUID NOT NULL REFERENCES public.goals (id) ON DELETE CASCADE,

  -- The scope this version plans for. NULL = the goal is not tied to a single
  -- account, which is a real state (a household target) and not a missing one.
  account_id       UUID REFERENCES public.accounts (id) ON DELETE SET NULL,

  -- When this version STARTED being the goal, which is not when the row was
  -- written: a goal agreed on Sunday and entered on Tuesday was in force from
  -- Sunday, and a decision taken on Monday cited it (Phase 1d).
  effective_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- GOAL-003. Which kind of starting point the plan was built on.
  baseline_type    TEXT NOT NULL,
  -- The figure itself. NULL = the baseline is NOT KNOWN, which is different
  -- from zero and must not be planned from (rule 13).
  baseline_value   NUMERIC,

  target_date      DATE,
  target_value     NUMERIC,
  -- As a fraction, not a percentage: 0.12, never 12. A column that accepts both
  -- is a column that will hold both.
  target_return_pct NUMERIC,

  -- What goes in, what comes out, what is not allowed, and what the projection
  -- assumed. JSONB rather than columns because each is a small structured plan
  -- whose shape is still moving, and a wrong column is harder to undo than a
  -- wrong key. The shapes are defined in `src/lib/goalVersion.ts`.
  contribution_plan JSONB,
  withdrawal_plan   JSONB,
  risk_constraints  JSONB,
  -- The assumptions a projection made — return, volatility, inflation, the
  -- model used. Recorded so a projection can be re-read later against what it
  -- assumed rather than against what is assumed now.
  model_assumptions JSONB,

  -- The version this one replaces. NULL for the first. A chain rather than a
  -- version number, so two versions written from two devices cannot collide on
  -- an integer.
  supersedes_id    UUID REFERENCES public.goal_versions (id) ON DELETE SET NULL,
  -- Why it changed, in the holder's words. The single most useful column here
  -- and the one `goals.updated_at` could never hold.
  note             TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'goal_versions_bounds') THEN
    ALTER TABLE public.goal_versions
      ADD CONSTRAINT goal_versions_bounds
      CHECK (
        baseline_type IN ('broker_equity', 'manual_plan')
        AND (baseline_value IS NULL OR baseline_value >= 0)
        AND (target_value IS NULL OR target_value > 0)
        -- A fraction. 12 here would mean 1,200% a year, and the app would
        -- believe it: `requiredCagrWithContributions` takes a fraction.
        AND (target_return_pct IS NULL OR (target_return_pct > -1 AND target_return_pct < 10))
        -- A version that names neither a target value nor a target return
        -- plans for nothing.
        AND (target_value IS NOT NULL OR target_return_pct IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS goal_versions_goal_effective_idx
  ON public.goal_versions (goal_id, effective_at DESC);
CREATE INDEX IF NOT EXISTS goal_versions_user_idx ON public.goal_versions (user_id);

-- The pointer that makes a past decision readable. NULL on every existing row
-- and on any decision taken before a version existed: NOT KNOWN which goal it
-- was taken under, which is the truth and is more useful than a guess.
ALTER TABLE public.decisions
  ADD COLUMN IF NOT EXISTS goal_version_id UUID REFERENCES public.goal_versions (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS decisions_goal_version_idx ON public.decisions (goal_version_id);

-- SELECT and INSERT only. The absence of UPDATE and DELETE policies is the
-- immutability, under RLS, for every authenticated caller.
GRANT SELECT, INSERT ON public.goal_versions TO authenticated;
GRANT SELECT, INSERT ON public.goal_versions TO service_role;
ALTER TABLE public.goal_versions ENABLE ROW LEVEL SECURITY;

-- And a hard stop for anything that bypasses RLS. A silent rewrite of a goal
-- version would make every decision citing it a lie, quietly.
CREATE OR REPLACE FUNCTION public.goal_versions_are_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION
    'goal_versions is append-only (GOAL-002): a version cited by a past decision cannot be edited or deleted. Insert a new version with supersedes_id set instead.';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'goal_versions' AND policyname = 'read own goal versions'
  ) THEN
    CREATE POLICY "read own goal versions" ON public.goal_versions
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'goal_versions' AND policyname = 'append own goal versions'
  ) THEN
    CREATE POLICY "append own goal versions" ON public.goal_versions
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_goal_versions_immutable') THEN
    CREATE TRIGGER trg_goal_versions_immutable
      BEFORE UPDATE OR DELETE ON public.goal_versions
      FOR EACH ROW EXECUTE FUNCTION public.goal_versions_are_immutable();
  END IF;
END $$;

COMMENT ON TABLE public.goal_versions IS
  'Immutable goal history (GOAL-001/002). Every save appends a row; nothing is ever updated. `goals` remains the current goal — this is what it USED to be, and what each past decision was taken under.';
COMMENT ON COLUMN public.goal_versions.baseline_type IS
  'GOAL-003. ''broker_equity'' = what the account is worth, from the broker, chosen by nobody. ''manual_plan'' = a planning figure the holder entered. One column with two values so a row cannot carry both and leave the reader guessing.';
COMMENT ON COLUMN public.goal_versions.target_return_pct IS
  'A FRACTION (0.12), never a percentage (12). Reconciliation against target_value is deliberately not a CHECK — it needs the horizon and the contribution plan — and lives in src/lib/goalVersion.ts, which refuses to pick a winner when the two conflict.';
COMMENT ON COLUMN public.goal_versions.effective_at IS
  'When the version STARTED being the goal, not when the row was written. A goal agreed on Sunday and entered on Tuesday was in force from Sunday.';
COMMENT ON COLUMN public.decisions.goal_version_id IS
  'The goal version this decision was taken under. NULL = NOT KNOWN (every decision predating versioning), which is the truth and more useful than pointing at today''s goal.';
