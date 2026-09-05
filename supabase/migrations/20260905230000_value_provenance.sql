-- Where a financial figure came from, and when it was true (Phase 1d, rule 14).
--
-- The app holds money figures with no record of their origin. `accounts.cash`
-- and `accounts.margin_used` are whatever was last written — by a balance
-- import, by a CSV import, or by somebody typing into Settings — and nothing
-- distinguishes those. So a balance pasted three months ago is presented
-- exactly like one pasted this morning, and a figure the owner typed from
-- memory is presented exactly like one the broker reported.
--
-- `account_balances` (2026-09-03) already carries part of the pattern:
-- `imported_at` is the AS-OF (when the figures were true) and `created_at` is
-- the RETRIEVED-AT (when the row was written), and the distinction is already
-- documented there. This extends that pattern rather than inventing a second
-- one, and gives `accounts` the same provenance for the figures the app
-- actually computes with.
--
-- KNOWN LIMITATION, recorded rather than hidden: provenance on `accounts` is
-- per BLOCK, not per field. The four money columns are written together by an
-- import, so one set of columns describes them honestly in that case — but
-- hand-editing a single field in Settings marks the whole block as user entry,
-- which understates the cash figure that came from the last import. Per-field
-- provenance is sixteen more columns and belongs with the canonical model in
-- Phase 2, where the figures stop being four loose columns.
--
-- Not money-adjacent under OD-001: this records where values came from. It
-- computes no trade, sizes no position, changes no balance and sets no
-- threshold. It makes the app able to say how old a figure is, which it
-- currently cannot.

-- --- accounts: provenance for the current figures -----------------------------
ALTER TABLE public.accounts
  -- 'imported_snapshot' | 'user_entry' | 'live_quote' | 'delayed_quote'.
  -- NULL = not known, which is its own state and NOT the same as stale: the fix
  -- for an unknown age is recording provenance, not importing again.
  ADD COLUMN IF NOT EXISTS balances_source_type TEXT,
  -- Which path wrote them, in words: 'fidelity_balances_paste',
  -- 'positions_csv', 'settings_form', 'margin_card'. Free text on purpose —
  -- a constrained list here would need a migration every time an import path is
  -- added, and this field is read by people, not branched on.
  ADD COLUMN IF NOT EXISTS balances_source TEXT,
  -- When the figures were TRUE. Distinct from updated_at, which is when the row
  -- was last written: a block pasted on Thursday morning may be Wednesday's
  -- close, and it is the former that decides whether a decision rests on
  -- history.
  ADD COLUMN IF NOT EXISTS balances_as_of TIMESTAMPTZ;

-- --- account_balances: the two fields the pattern was missing ------------------
ALTER TABLE public.account_balances
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT,
  -- ISO 4217. Rule 32: USD-only is acceptable, USD-ASSUMED is not — so the
  -- column exists and has no default, and the row says what it is rather than
  -- the reader assuming.
  ADD COLUMN IF NOT EXISTS currency TEXT;

-- Bounds only. NULL stays valid throughout — it is the shipped state for every
-- existing row, and "not known" is a state this phase exists to make sayable.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_provenance_bounds') THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_provenance_bounds
      CHECK (
        balances_source_type IS NULL OR balances_source_type IN
          ('live_quote', 'delayed_quote', 'imported_snapshot', 'user_entry')
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_balances_provenance_bounds') THEN
    ALTER TABLE public.account_balances
      ADD CONSTRAINT account_balances_provenance_bounds
      CHECK (
        (source_type IS NULL OR source_type IN
          ('live_quote', 'delayed_quote', 'imported_snapshot', 'user_entry'))
        AND (currency IS NULL OR currency ~ '^[A-Z]{3}$')
      );
  END IF;
END $$;

-- --- the one backfill, and only where it is a fact -----------------------------
-- Every existing `account_balances` row came from pasting a broker balances
-- block: that is the only path that writes this table, and `raw_text` is NOT
-- NULL, so each row demonstrably has a paste behind it. Recording that is not
-- an inference.
UPDATE public.account_balances
SET source_type = 'imported_snapshot',
    source = COALESCE(source, 'broker_balances_paste')
WHERE source_type IS NULL;

-- `accounts` is deliberately NOT backfilled. Its figures may have come from an
-- import, a CSV, or somebody typing, and there is no way to tell which — so
-- every existing row's provenance is genuinely unknown, and saying so is the
-- honest answer. They fill in as each account is next written.

COMMENT ON COLUMN public.accounts.balances_as_of IS
  'When the cash/margin figures were TRUE, not when the row was written (that is updated_at). NULL = not known, which is a different state from stale: the fix is recording provenance, not re-importing.';
COMMENT ON COLUMN public.accounts.balances_source_type IS
  'How the current figures arrived. NULL = not known. Per BLOCK, not per field — see the migration header for why, and Phase 2 for where that is fixed.';
COMMENT ON COLUMN public.account_balances.source_type IS
  'How this observation arrived. Backfilled to imported_snapshot for existing rows, which is a fact rather than a guess: pasting is the only path that writes this table and raw_text is NOT NULL.';
