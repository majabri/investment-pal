-- No broker is assumed (Phase 1c; rule 2 of the user-agnostic financial truth
-- standard).
--
-- `public.accounts.name` is declared `NOT NULL DEFAULT 'Fidelity'`. Two
-- separate defects in one line:
--
--   * It names a specific brokerage in the schema. An account created without
--     a name silently becomes "Fidelity", so the app ships one provider's name
--     as a fact about a user's account (rule 37: the app cannot serve someone
--     who banks elsewhere without a source change).
--   * It puts the provider in the DISPLAY NAME. `broker` is the column for the
--     institution — this default writes the institution into the field the user
--     reads and edits as a label, so the two disagree from the moment a row is
--     created.
--
-- The default is removed. `name` stays NOT NULL: an account with no label at
-- all cannot be picked in the switcher or named in a prompt, and every path
-- that creates one already supplies a name. That is different from the balance
-- columns, where the missing value is a FACT ABOUT MONEY and has to stay
-- expressible; a missing label is a UI problem with no honest rendering.
--
-- Existing rows keep whatever they hold. A row that genuinely says "Fidelity"
-- may be a label the owner chose, and this migration cannot tell that apart
-- from one that fell through the default — so it changes nothing. Phase 1b's
-- `broker` column is where the institution goes from here.
--
-- Not money-adjacent under OD-001: this changes a label's default. It computes
-- no trade, sizes no position, moves no balance and sets no threshold.
ALTER TABLE public.accounts
  ALTER COLUMN name DROP DEFAULT;

COMMENT ON COLUMN public.accounts.name IS
  'Display name, presentation only as of Phase 1b — nothing derives behaviour from it (that is account_type and tax_treatment). NOT NULL with no default as of Phase 1c: every creation path supplies one, and no brokerage is assumed. The institution belongs in accounts.broker.';

-- An account with a blank label cannot be picked in the switcher or named in a
-- prompt. `NOT NULL` alone does not prevent one, because '' satisfies it.
--
-- Added NOT VALID on purpose: it applies to every insert and update from here
-- on, and does NOT re-check rows that already exist. A migration that fails
-- because of one bad legacy row leaves the schema half-applied on a database
-- that deploys live; validating existing rows is a separate, reversible step
-- (`ALTER TABLE ... VALIDATE CONSTRAINT accounts_name_not_blank`) once they are
-- known to be clean.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_name_not_blank') THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_name_not_blank CHECK (btrim(name) <> '') NOT VALID;
  END IF;
END $$;
