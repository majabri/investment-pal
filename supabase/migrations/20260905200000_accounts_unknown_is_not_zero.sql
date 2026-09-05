-- Unknown is not zero (Phase 1a; rule 13 of the user-agnostic financial truth
-- standard).
--
-- `public.accounts` declared its four money columns as
--
--   cash          NUMERIC NOT NULL DEFAULT 0,
--   margin_used   NUMERIC NOT NULL DEFAULT 0,
--   margin_limit  NUMERIC NOT NULL DEFAULT 0,
--   buying_power  NUMERIC NOT NULL DEFAULT 0,
--
-- which makes "we do not know" IMPOSSIBLE TO EXPRESS. A failed import, a
-- balance block that omitted a field, a broker that does not report one, and an
-- account nobody has ever populated are all indistinguishable from an account
-- that genuinely holds no cash and owes nothing on margin.
--
-- The consequence is not cosmetic. `accountTotals()` computes
-- `cash + positions - margin_used`, so an unpopulated account reports a
-- confident total account value that is wrong by the whole size of the missing
-- figure — and reports it in the same typeface as a figure the broker actually
-- supplied. Every layer above inherits this, and the readiness gate the
-- standard requires cannot be built at all, because the data layer has no way
-- to say "unavailable".
--
-- `account_balances` (2026-09-03) already got this right: every money column
-- there is nullable with no default, for exactly this reason. This migration
-- brings `accounts` into line with the table that records what fills it.
--
-- EXISTING ROWS ARE UNTOUCHED. Dropping NOT NULL and the default changes no
-- stored value; a row that currently holds 0 still holds 0. Only new and
-- unpopulated rows can now be NULL. This is deliberate: a stored 0 might be a
-- real zero balance that someone confirmed, and this migration cannot tell the
-- difference — rewriting them to NULL would destroy real information to fix a
-- schema defect. Provenance (Phase 1d) is what will eventually distinguish the
-- two.
--
-- Money-adjacent under OD-001, and merged under the standing authority of the
-- 2026-09-05 master brief, which directs this change by name and instructs
-- self-merge on a green gate. It computes no trade, sizes no position and sets
-- no threshold; it removes the app's ability to state a balance nobody gave it.
ALTER TABLE public.accounts
  ALTER COLUMN cash         DROP DEFAULT,
  ALTER COLUMN cash         DROP NOT NULL,
  ALTER COLUMN margin_used  DROP DEFAULT,
  ALTER COLUMN margin_used  DROP NOT NULL,
  ALTER COLUMN margin_limit DROP DEFAULT,
  ALTER COLUMN margin_limit DROP NOT NULL,
  ALTER COLUMN buying_power DROP DEFAULT,
  ALTER COLUMN buying_power DROP NOT NULL;

COMMENT ON COLUMN public.accounts.cash IS
  'Cash market value. NULL = not known (never imported, or the source did not supply it), which is a different fact from 0. Consumers must render NULL as unavailable, never as $0.00.';
COMMENT ON COLUMN public.accounts.margin_used IS
  'Margin debit as a POSITIVE magnitude, matching account_balances.net_debit. NULL = not known; 0 = the broker reported no margin loan.';
COMMENT ON COLUMN public.accounts.margin_limit IS
  'Margin borrowing limit. NULL = not known; 0 = no margin available on this account.';
COMMENT ON COLUMN public.accounts.buying_power IS
  'Broker-reported buying power. NULL = not known. Informational: buying power is not an asset and is never summed into equity.';
