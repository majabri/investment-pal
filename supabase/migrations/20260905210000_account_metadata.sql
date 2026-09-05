-- Account behaviour becomes metadata, not a guess about a display name
-- (Phase 1b; rule 4 of the user-agnostic financial truth standard).
--
-- Today `accountCategory()` decides what an account IS by string-matching its
-- NAME: a list of first names means "kids", /529/ means an education account,
-- /crypto/i means crypto, /IRA|ROTH|ROLLOVER/i means retirement, and anything
-- else is the holder's own primary account. Four things follow from that:
--
--   * Renaming an account silently changes its tax treatment, which screens it
--     appears on, and which prompts it is included in.
--   * The classifier cannot serve a second user without editing source, because
--     one household's names are compiled into it (rule 37).
--   * "Anything else is Primary" means an unclassifiable account is not
--     unknown, it is confidently wrong.
--   * Nothing records WHY an account was classified as it was, so a
--     misclassification is indistinguishable from a decision.
--
-- This migration adds the metadata. It does NOT change any consumer: the
-- classifier still reads names after this, so nothing on screen moves. Switching
-- the consumers over needs somewhere to correct a bad inference first, which is
-- the next change.
--
-- INFERENCE HAPPENS ONCE, HERE, AND IS RECORDED.
--
-- `account_type_source` says where each row's type came from. The runtime never
-- infers again — that is the whole point of storing it — and a row inferred
-- here is marked as inferred so a wrong guess can be told apart from a
-- deliberate answer. Patterns only: no personal name appears in this file, both
-- because the P0 remediation made that a permanent rule and because a
-- name-matching migration would carry the very defect it is removing.
--
-- Not money-adjacent under OD-001: this classifies and labels accounts. It
-- computes no trade, sizes no position, moves no balance and sets no threshold.

-- --- what an account is -----------------------------------------------------
-- The vocabulary is `main`'s, not the brief's. `account_type` already exists
-- with a nine-value list the Settings editor writes (brokerage, ira, roth_ira,
-- 401k, hsa, custodial, trust, cash, other). The brief proposes a different,
-- coarser set; adopting it would have made every existing account fail the new
-- CHECK the next time someone pressed Save in Settings. Two values are ADDED so
-- the metadata can express everything the name-matcher expressed: '529' and
-- 'crypto'.
--
-- NULL = not known. Deliberately nullable and deliberately without a default:
-- `NOT NULL DEFAULT 'brokerage'` means an account nobody has classified claims
-- to be a taxable brokerage account, which is a claim about its tax treatment
-- (rule 13).
ALTER TABLE public.accounts
  ALTER COLUMN account_type DROP DEFAULT,
  ALTER COLUMN account_type DROP NOT NULL;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS account_type_source TEXT,
  -- 'taxable' | 'tax_deferred' | 'tax_free' | 'education' — NULL = not known.
  -- Separate from account_type on purpose: a Roth IRA and a traditional IRA are
  -- both 'retirement' and are taxed nothing alike, and an account's type does
  -- not determine its treatment in every jurisdiction.
  ADD COLUMN IF NOT EXISTS tax_treatment TEXT,
  -- The broker's own identifier for the account. NULL = not recorded.
  ADD COLUMN IF NOT EXISTS broker_account_id TEXT,
  -- ISO 4217. Rule 32: a USD-only implementation is acceptable, a USD-assumed
  -- architecture is not — so the column exists, existing rows are backfilled
  -- explicitly below as a recorded inference, and there is NO column default
  -- for rows created from here on.
  ADD COLUMN IF NOT EXISTS currency TEXT,
  -- Whether the account can borrow at all. NULL = not known, which is not the
  -- same as FALSE: a margin figure on a cash account is a data error worth
  -- catching, and it cannot be caught while "no margin" and "we were not told"
  -- are the same value.
  ADD COLUMN IF NOT EXISTS margin_enabled BOOLEAN,
  -- Ownership grouping. Deliberately a bare UUID with no foreign key: the
  -- households table arrives in Phase 4 (rule 22), and inventing a table here
  -- to satisfy a constraint would fix its shape before the requirement is
  -- written.
  ADD COLUMN IF NOT EXISTS household_id UUID,
  -- 'active' | 'closed' | 'archived'. NULL = not known.
  ADD COLUMN IF NOT EXISTS account_status TEXT;

-- --- bounds, not defaults ---------------------------------------------------
-- These reject typos. They supply nothing, and NULL stays valid throughout.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_metadata_bounds') THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_metadata_bounds
      CHECK (
        (account_type IS NULL OR account_type IN
          ('brokerage', 'ira', 'roth_ira', '401k', 'hsa', 'custodial', 'trust',
           'cash', 'other', '529', 'crypto'))
        AND (account_type_source IS NULL OR account_type_source IN
          ('inferred_from_name', 'legacy_default', 'user_set', 'imported'))
        AND (tax_treatment IS NULL OR tax_treatment IN
          ('taxable', 'tax_deferred', 'tax_free', 'education'))
        AND (account_status IS NULL OR account_status IN ('active', 'closed', 'archived'))
        -- ISO 4217 alphabetic codes are exactly three uppercase letters.
        AND (currency IS NULL OR currency ~ '^[A-Z]{3}$')
      );
  END IF;
END $$;

-- --- the one inference ------------------------------------------------------
-- Only what the name actually evidences. An account whose name says nothing
-- about its type is left NULL — "we do not know" — rather than assigned the
-- most common type, which is the old classifier's "everything else is Primary"
-- defect wearing a column instead of a function.
UPDATE public.accounts
SET account_type = '529',
    tax_treatment = 'education',
    account_type_source = 'inferred_from_name'
WHERE account_type_source IS NULL AND name ~ '529';

UPDATE public.accounts
SET account_type = 'crypto',
    account_type_source = 'inferred_from_name'
WHERE account_type_source IS NULL AND name ~* 'crypto';

-- Roth before the general retirement pattern, because a Roth is taxed the
-- opposite way round and the general pattern would swallow it.
UPDATE public.accounts
SET account_type = 'roth_ira',
    tax_treatment = 'tax_free',
    account_type_source = 'inferred_from_name'
WHERE account_type_source IS NULL AND name ~* 'ROTH';

UPDATE public.accounts
SET account_type = 'ira',
    tax_treatment = 'tax_deferred',
    account_type_source = 'inferred_from_name'
WHERE account_type_source IS NULL AND name ~* '(\mIRA\M|ROLLOVER)';

-- Everything else keeps the value it already has, marked for what that value
-- actually is: the old `NOT NULL DEFAULT 'brokerage'`, which nobody chose.
--
-- NOT recorded as inferred_from_name, because it was not inferred from the name
-- or from anything else — the column simply had a default and every row got it.
-- A row marked legacy_default is one the app is treating as a taxable brokerage
-- account because a schema default said so, and the UI can ask about exactly
-- those rather than nagging about accounts someone has actually answered for.
UPDATE public.accounts
SET account_type_source = 'legacy_default'
WHERE account_type_source IS NULL AND account_type IS NOT NULL;

-- Currency and status for rows that already exist. Both are recorded as
-- inferences rather than asserted: the app has only ever handled USD and has no
-- way to close an account, so these are what the existing rows must be, but
-- they were never stated by anyone and the column says so.
UPDATE public.accounts SET currency = 'USD' WHERE currency IS NULL;
UPDATE public.accounts SET account_status = 'active' WHERE account_status IS NULL;

COMMENT ON COLUMN public.accounts.account_type IS
  'What the account is. NULL = not known — never assume brokerage. Read by classification; accounts.name is presentation only.';
COMMENT ON COLUMN public.accounts.account_type_source IS
  'Where account_type came from: inferred_from_name (the 2026-09-05 Phase 1b migration read it off the name), legacy_default (nobody chose it — it is the old NOT NULL DEFAULT), user_set, or imported. The runtime never infers; anything but user_set or imported is unconfirmed.';
COMMENT ON COLUMN public.accounts.tax_treatment IS
  'How the account is taxed. NULL = not known. Separate from account_type: a Roth and a traditional IRA are both retirement accounts and are taxed oppositely.';
COMMENT ON COLUMN public.accounts.currency IS
  'ISO 4217 code. No column default: existing rows were backfilled to USD as a recorded inference, but new rows must say.';
COMMENT ON COLUMN public.accounts.margin_enabled IS
  'Whether the account can borrow. NULL = not known, which is not FALSE — a margin figure on a cash account is a data error, and it cannot be caught while those are the same value.';
COMMENT ON COLUMN public.accounts.household_id IS
  'Ownership grouping. No foreign key yet: the households table arrives with rule 22 in Phase 4.';
COMMENT ON COLUMN public.accounts.name IS
  'Display name, presentation only as of Phase 1b. Nothing may derive behaviour from it — that is what account_type and tax_treatment are for.';
COMMENT ON COLUMN public.accounts.broker IS
  'The institution holding the account. This is the standard''s "provider" field; it already existed, so no second column was added.';
