-- Imported broker balances, one row per account per import (Stage 2).
--
-- Until now the balance figures — total account value, the margin debit,
-- buying power, accrued interest — were four number boxes on the Portfolio
-- screen, typed in by hand and overwritten in place. That has two costs:
--
--   * Hand-typed money goes stale silently. Nothing compared the app's total
--     against the broker's, so a missing position or a stale price showed up
--     as a confident wrong number.
--   * Overwriting in place destroys the series. Day change and accrued
--     interest only mean anything against previous values, and there were none.
--
-- So this table APPENDS. There is deliberately no unique constraint on
-- (account_id, day) and no upsert path: importing twice on the same day keeps
-- both rows, because the second import is a later observation, not a
-- correction of the first. `accounts` still holds the current figures for the
-- app to compute with; this is the record of what the broker actually said and
-- when.
--
-- Every money column is NULLABLE with NO DEFAULT. A balance block that omits a
-- field stores NULL, which reads as "the paste did not say" — a different fact
-- from zero, which would read as "this account has no margin loan". Defaulting
-- any of these to 0 would reintroduce exactly the silent partial accept the
-- import exists to prevent.
--
-- Not money-adjacent under OD-001: this stores and measures what the broker
-- reported. It computes no trade, sizes no position, and sets no threshold.
CREATE TABLE IF NOT EXISTS public.account_balances (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  account_id  UUID NOT NULL REFERENCES public.accounts (id) ON DELETE CASCADE,

  -- When the figures were captured from the broker. Distinct from created_at:
  -- a block pasted on Thursday morning may be Wednesday's close.
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Fidelity's "Total account value" — net, after the debit.
  total_account_value         NUMERIC,
  day_change                  NUMERIC,
  -- Percentage (89 for 89.00%), not a fraction. Same convention as
  -- ips_lite.margin_rate_annual_pct, so the two are never divided differently.
  equity_pct                  NUMERIC,
  margin_buying_power         NUMERIC,
  non_margin_buying_power     NUMERIC,
  committed_to_open_orders    NUMERIC,
  net_house_surplus           NUMERIC,
  -- What the broker actually accrued this month. An observed fact, and
  -- therefore preferred over the app's own estimate when both exist.
  margin_interest_accrued_mtd NUMERIC,
  -- Percentage (9.750 for 9.75%), not a fraction.
  margin_interest_rate_pct    NUMERIC,
  cash_market_value           NUMERIC,
  margin_market_value         NUMERIC,
  -- POSITIVE magnitude, matching accounts.margin_used. Fidelity prints this as
  -- a negative; the parser normalises the sign once, on the way in, so no
  -- consumer can get the direction wrong. A sign error on a debit is silent
  -- and the size of the whole loan.
  net_debit                   NUMERIC,

  -- The paste, verbatim. Kept so a mis-parse can be diagnosed against what was
  -- actually pasted, rather than re-derived from a figure that is already
  -- wrong. Not displayed; read when something disagrees.
  -- NOT NULL and NO DEFAULT, like the money columns and for the same reason:
  -- a row that slipped in without its paste cannot be diagnosed against
  -- anything, and an empty-string default makes that silently possible.
  raw_text    TEXT NOT NULL,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.account_balances IS
  'Append-only log of broker balance imports. One row per account per import; never updated in place. accounts holds the current figures, this holds the history of what the broker reported.';
COMMENT ON COLUMN public.account_balances.net_debit IS
  'Margin debit as a POSITIVE magnitude (Fidelity prints it negative). NULL = the paste did not supply it, which is not the same as zero.';
COMMENT ON COLUMN public.account_balances.equity_pct IS
  'Equity as a percentage (89 for 89.00%), not a fraction.';
COMMENT ON COLUMN public.account_balances.margin_interest_rate_pct IS
  'Annual margin rate as a percentage (9.750 for 9.75%), not a fraction. Same convention as ips_lite.margin_rate_annual_pct.';
COMMENT ON COLUMN public.account_balances.margin_interest_accrued_mtd IS
  'Interest the broker has actually accrued this month. An observed figure — displayed in preference to the app''s estimate, which is labelled as an estimate.';

-- Bounds only. These reject data errors; they supply nothing and NULL stays
-- valid throughout, which is the shipped state for every column here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_balances_bounds') THEN
    ALTER TABLE public.account_balances
      ADD CONSTRAINT account_balances_bounds
      CHECK (
        (equity_pct IS NULL OR (equity_pct >= 0 AND equity_pct <= 1000))
        AND (margin_interest_rate_pct IS NULL OR (margin_interest_rate_pct >= 0 AND margin_interest_rate_pct <= 100))
        -- The debit is stored positive. A negative here means the sign was
        -- normalised the wrong way somewhere, and that must fail loudly.
        AND (net_debit IS NULL OR net_debit >= 0)
        AND (margin_interest_accrued_mtd IS NULL OR margin_interest_accrued_mtd >= 0)
      );
  END IF;
END $$;

-- The common read: the latest import for one account.
CREATE INDEX IF NOT EXISTS account_balances_account_imported_idx
  ON public.account_balances (account_id, imported_at DESC);

-- Append-only is enforced, not just described: SELECT and INSERT only, with no
-- UPDATE and no DELETE for the signed-in role. Granting them and relying on the
-- app never to call them makes the invariant a convention, and a convention
-- cannot protect a history whose whole value is that it was not rewritten.
-- Deleting the account still removes its rows, via the ON DELETE CASCADE above.
GRANT SELECT, INSERT ON public.account_balances TO authenticated;
GRANT ALL ON public.account_balances TO service_role;
ALTER TABLE public.account_balances ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'account_balances' AND policyname = 'own account balances'
  ) THEN
    -- An earlier FOR ALL policy would keep permitting UPDATE and DELETE at the
    -- row level even with the grants withdrawn. Replace it rather than leaving
    -- two policies disagreeing about what this table allows.
    DROP POLICY "own account balances" ON public.account_balances;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'account_balances' AND policyname = 'read own account balances'
  ) THEN
    CREATE POLICY "read own account balances" ON public.account_balances
      FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'account_balances' AND policyname = 'insert own account balances'
  ) THEN
    -- `user_id = auth.uid()` alone would let a row be filed against someone
    -- else's account_id if one were ever guessed. The account must be the
    -- caller's too, or the balance is attached to an account they cannot see.
    CREATE POLICY "insert own account balances" ON public.account_balances
      FOR INSERT WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
          SELECT 1 FROM public.accounts a
          WHERE a.id = account_id AND a.user_id = auth.uid()
        )
      );
  END IF;
END $$;
