-- Cash flows, so performance stops counting deposits as returns (PERF-001).
--
-- `portfolioSummary.performance()` computes `latest.net - start.net` and prints
-- it under the heading "1 month" beside a percentage. There is no cash-flow
-- record anywhere in the schema, so a $10,000 deposit is indistinguishable from
-- $10,000 of investment return — and it is reported as return, with a
-- percentage, in the same typeface as a real one. A withdrawal reads as a loss.
--
-- That defect cannot be fixed in the arithmetic alone. It needs the flows
-- themselves, dated and account-scoped, which is what this table is.
--
-- WHAT IS AND IS NOT AN EXTERNAL FLOW
--
-- Only money crossing the portfolio's boundary is an external flow, and only
-- external flows are removed from return:
--
--   * A deposit or withdrawal is external. It changes what the portfolio holds
--     without anything having been earned or lost.
--   * A dividend that STAYS in the account is INTERNAL — it is return, and
--     subtracting it would understate performance by exactly the dividend.
--     A dividend SWEPT OUT to a bank account is external, on the way out.
--   * A fee or margin interest charge paid FROM the account is internal: it is
--     a real cost of the strategy and belongs in the return. Paid from outside
--     the account, it is an external contribution.
--
-- So `kind` records what happened and `treatment` records how the arithmetic
-- must handle it. They are separate columns because the same kind can be
-- either, and guessing is how a dividend gets counted twice or not at all.
--
-- WHY `accounts.cash_flows_as_of` MATTERS MORE THAN THE TABLE
--
-- An account with no rows here has two possible meanings: it had no flows, or
-- nobody has told the app about them. Computing a time-weighted return under
-- the first reading when the second is true reproduces PERF-001 exactly — a
-- confident, wrong number, now with a better name on it. `cash_flows_as_of`
-- makes them distinguishable, and NULL (every existing account) means NOT
-- KNOWN, so performance falls back to reporting a change in value and SAYS so.
--
-- Money-adjacent under OD-001 in the sense that it is the substrate for a
-- return figure. No arithmetic here changes any existing number: this migration
-- adds a table and one nullable column, and nothing reads either until the
-- accompanying code does. Rule 13 (unknown is not zero) and rule 29
-- (account-scoped) throughout.
CREATE TABLE IF NOT EXISTS public.cash_flows (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  -- Required. A flow that cannot say which account it crossed cannot be used
  -- to correct that account's return (rule 29).
  account_id   UUID NOT NULL REFERENCES public.accounts (id) ON DELETE CASCADE,

  -- The date the money moved, as a CALENDAR date in the holder's own zone.
  -- Not a timestamp: a flow is settled on a day, and a timestamp would drag
  -- this back into the UTC-vs-local defect class fixed in P0-04.
  flow_date    DATE NOT NULL,

  -- What happened.
  kind         TEXT NOT NULL,

  -- Signed, positive = money INTO the portfolio. A deposit is +, a withdrawal
  -- and a fee are −. Signed rather than a magnitude plus a direction because a
  -- direction column that disagrees with its sign is a silent inversion, and
  -- the CHECK below makes the disagreement impossible instead.
  amount       NUMERIC NOT NULL,

  -- How the return arithmetic must treat it. See the header: `kind` alone does
  -- not determine this, and defaulting it from `kind` is how a dividend gets
  -- counted twice.
  treatment    TEXT NOT NULL,

  -- The holding a dividend belongs to, where it is known. Never load-bearing
  -- for the return — attribution only.
  symbol       TEXT,

  -- Where the row came from. No AI value (rule 18).
  source       TEXT NOT NULL,
  -- The broker's own identifier, for idempotent re-import.
  source_ref   TEXT,
  note         TEXT,
  -- When the figure was TRUE, not when the row was written (Phase 1d).
  as_of        TIMESTAMPTZ,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_flows_bounds') THEN
    ALTER TABLE public.cash_flows
      ADD CONSTRAINT cash_flows_bounds
      CHECK (
        kind IN ('deposit', 'withdrawal', 'dividend', 'fee', 'interest')
        AND treatment IN ('external', 'internal')
        AND source IN ('imported', 'user_entry', 'derived')
        AND amount <> 0
        -- The sign is not a matter of opinion for the two kinds that only go
        -- one way. A "deposit" of −5,000 is a withdrawal typed into the wrong
        -- box, and it would subtract 5,000 from return instead of adding it.
        AND (kind <> 'deposit' OR amount > 0)
        AND (kind <> 'withdrawal' OR amount < 0)
        -- `fee` and `interest` are deliberately NOT sign-constrained. A fee is
        -- normally paid from the account (negative), but a fee rebate, or a
        -- charge somebody settled from outside it, is a real positive flow and
        -- refusing to record one would push it into the return instead.
        -- `dividend` likewise: normally positive, negative when reversed.
        AND (symbol IS NULL OR btrim(symbol) <> '')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cash_flows_account_date_idx
  ON public.cash_flows (account_id, flow_date);
CREATE INDEX IF NOT EXISTS cash_flows_user_idx ON public.cash_flows (user_id);

-- Idempotent re-import. Partial, so any number of hand-entered flows coexist.
CREATE UNIQUE INDEX IF NOT EXISTS cash_flows_source_ref_unique
  ON public.cash_flows (account_id, source_ref)
  WHERE source_ref IS NOT NULL;

-- Whether the app has been told this account's FLOW history, distinct from
-- whether any flows exist. NULL — every existing account — means nobody has
-- said, and a return computed as though there were none is the PERF-001 defect
-- wearing a better name (rule 13).
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS cash_flows_as_of TIMESTAMPTZ;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_flows TO authenticated;
GRANT ALL ON public.cash_flows TO service_role;
ALTER TABLE public.cash_flows ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cash_flows' AND policyname = 'own cash flows'
  ) THEN
    CREATE POLICY "own cash flows" ON public.cash_flows
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cash_flows_updated') THEN
    CREATE TRIGGER trg_cash_flows_updated
      BEFORE UPDATE ON public.cash_flows
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE public.cash_flows IS
  'Money crossing the portfolio boundary, dated and account-scoped (PERF-001). Without it, performance() reported a deposit as investment return. Only rows with treatment = ''external'' are removed from return.';
COMMENT ON COLUMN public.cash_flows.amount IS
  'Signed; positive = into the portfolio. A CHECK forbids a negative deposit and a positive withdrawal, because a sign typed the wrong way round inverts the return correction silently.';
COMMENT ON COLUMN public.cash_flows.treatment IS
  '''external'' = crossed the portfolio boundary and is removed from return. ''internal'' = happened inside it and IS return: a dividend left in the account, a fee paid from it. Not derivable from `kind` — a swept dividend is external, a retained one is not.';
COMMENT ON COLUMN public.accounts.cash_flows_as_of IS
  'When the app was last told this account''s flow history. NULL = never, so no rows means NOT KNOWN rather than no flows, and performance falls back to a labelled change in value.';
