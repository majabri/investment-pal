-- Household membership becomes data (Phase 4, rule 22).
--
-- `src/lib/data/familyPolicy.ts` carries three children as a compiled-in array:
-- names and BIRTH DATES, in application source, in a public repository. Two
-- separate problems in one constant.
--
--   * It is personal data about minors in `src/`, which the standing
--     constraints make a permanent rule rather than a cleanup task. It is the
--     last such data in the tree after the P0 remediation.
--   * It is an ASSUMED DEPENDANT. Rule 22: household is optional, family
--     surfaces appear only when applicable accounts exist, and no dependant is
--     assumed. A second user of this app inherits three children.
--
-- The birth dates are the part that matters most and the reason this is a table
-- rather than a deletion: `/kids` reads them for age, and age drives the
-- allocation guidance. They are load-bearing, so they need somewhere to live —
-- deleting them would break the screen, and leaving them where they are keeps
-- one family's minors in a public repository.
--
-- NO ROWS ARE PROVISIONED. A new user has no household members, and the family
-- surfaces say so and offer to add one. That is the rule 22 requirement stated
-- as behaviour: the app must not know about anybody's children until somebody
-- tells it.
--
-- Not money-adjacent under OD-001: this stores who an account belongs to. It
-- computes no trade, sizes no position, moves no balance and sets no threshold.
CREATE TABLE IF NOT EXISTS public.household_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,

  -- What to call them on screen. NOT NULL with no default and a non-blank
  -- check: an unnamed member cannot be told apart from another unnamed member,
  -- and every creation path asks for one.
  display_name TEXT NOT NULL,

  -- NULL = not known. Deliberately nullable: age-based guidance is one feature
  -- among several, and a member whose birth date nobody has entered should
  -- still appear with their accounts rather than being unaddable (rule 13).
  birth_date   DATE,

  -- 'self' | 'dependant' | 'partner' | 'other'. NULL = not stated.
  -- Deliberately not 'child': the app cares whether a longer horizon and a
  -- custodial arrangement apply, and "dependant" is what that means without
  -- assuming a family shape.
  relationship TEXT,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'household_members_bounds') THEN
    ALTER TABLE public.household_members
      ADD CONSTRAINT household_members_bounds
      CHECK (
        btrim(display_name) <> ''
        AND (relationship IS NULL OR relationship IN ('self', 'dependant', 'partner', 'other'))
      );
  END IF;
END $$;

-- Which member an account belongs to. NULL = not stated, which is the shipped
-- state for every existing row: the app has never asked, and inferring an owner
-- from an account's NAME is the defect Phase 1b removed.
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS owner_member_id UUID REFERENCES public.household_members (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS accounts_owner_member_idx ON public.accounts (owner_member_id);
CREATE INDEX IF NOT EXISTS household_members_user_idx ON public.household_members (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.household_members TO authenticated;
GRANT ALL ON public.household_members TO service_role;
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'household_members' AND policyname = 'own household members'
  ) THEN
    CREATE POLICY "own household members" ON public.household_members
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_household_members_updated') THEN
    CREATE TRIGGER trg_household_members_updated
      BEFORE UPDATE ON public.household_members
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE public.household_members IS
  'Who an account belongs to. No rows are provisioned for a new user — rule 22: household is optional and no dependant is assumed. Replaces a hardcoded array of children in application source.';
COMMENT ON COLUMN public.household_members.birth_date IS
  'NULL = not known. Used for age-based guidance where present; a member without one still appears with their accounts.';
COMMENT ON COLUMN public.household_members.relationship IS
  'Deliberately not "child": the app cares whether a longer horizon and a custodial arrangement apply, and "dependant" says that without assuming a family shape.';
COMMENT ON COLUMN public.accounts.owner_member_id IS
  'Which household member holds this account. NULL = not stated. Never inferred from the account name — that is the defect Phase 1b removed.';

-- `accounts.household_id` was added in the Phase 1b metadata migration as a
-- placeholder, with the note that "the households table arrives with rule 22 in
-- Phase 4". It has arrived, and it is per-MEMBER rather than per-household:
-- what every screen actually needs is whose account this is, and at single-user
-- scale a grouping above the member is a level nobody reads. The column stays
-- because dropping one is destructive and this one has never been written; the
-- comment is here so the next person does not wire up a second, competing
-- notion of ownership.
COMMENT ON COLUMN public.accounts.household_id IS
  'Unused. Superseded by owner_member_id (Phase 4). Never written by anything; do not start.';
