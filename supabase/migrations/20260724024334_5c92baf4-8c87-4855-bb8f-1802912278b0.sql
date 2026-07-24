
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'brokerage',
  ADD COLUMN IF NOT EXISTS broker text,
  ADD COLUMN IF NOT EXISTS starting_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS target_value numeric,
  ADD COLUMN IF NOT EXISTS target_date date,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.holdings
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE public.holdings DROP CONSTRAINT IF EXISTS holdings_user_id_symbol_key;

CREATE UNIQUE INDEX IF NOT EXISTS holdings_user_account_symbol_key
  ON public.holdings(user_id, account_id, symbol)
  WHERE account_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS holdings_user_symbol_no_account_key
  ON public.holdings(user_id, symbol)
  WHERE account_id IS NULL;

CREATE INDEX IF NOT EXISTS holdings_account_id_idx ON public.holdings(account_id);
