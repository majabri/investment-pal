-- Snapshots belong to an account (Stage 5).
--
-- `portfolio_snapshots` was written with a hardcoded personal scope string,
-- one series for the whole household. Stage 1 removed exactly this defect from
-- every live figure in the app: the dashboard, portfolio, goal and prompt
-- totals used to blend TOD with the IRA, the kids' accounts, the 529s and
-- crypto. The recorded history kept doing it, so the balance-over-time chart
-- was still charting the blend.
--
-- Two columns:
--
--   account_id    — which account the snapshot describes. NULLABLE, because
--                   every existing row predates account scoping and there is
--                   no honest way to attribute a blended figure to one
--                   account. Guessing would put a household total on a single
--                   account's chart, which is the bug this fixes. Those rows
--                   stay, unattributed, and the chart says how many there are
--                   rather than silently drawing them.
--
--   snapshot_date — the calendar day the snapshot represents, supplied by the
--                   app in the OWNER's local calendar. The one-per-day rule
--                   was previously enforced by the client reading the last row
--                   and comparing UTC dates: racy, and wrong by a day for
--                   anyone west of Greenwich in the evening. Backfilled from
--                   created_at for existing rows, which is the best available
--                   fact about them.
--
-- Not money-adjacent: this records and partitions observations. It changes no
-- value and computes nothing.
ALTER TABLE public.portfolio_snapshots
  ADD COLUMN IF NOT EXISTS account_id    UUID REFERENCES public.accounts (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS snapshot_date DATE;

COMMENT ON COLUMN public.portfolio_snapshots.account_id IS
  'The account this snapshot describes. NULL on rows recorded before Stage 5, which are an all-accounts blend and cannot be attributed to one account — they are excluded from per-account charts rather than guessed at.';
COMMENT ON COLUMN public.portfolio_snapshots.snapshot_date IS
  'Calendar day the snapshot represents, in the owner''s local timezone. Supplied by the app, not derived from created_at, because the UTC date rolls over hours early west of Greenwich.';
COMMENT ON COLUMN public.portfolio_snapshots.scope IS
  'DEPRECATED (2026-09-03, Stage 5). A hardcoded personal/household scope string that predates account scoping. Use account_id.';

-- Best available fact about the legacy rows: the day they were created. It does
-- not make them attributable to an account — only dateable.
UPDATE public.portfolio_snapshots
   SET snapshot_date = (created_at AT TIME ZONE 'UTC')::date
 WHERE snapshot_date IS NULL;

-- One snapshot per account per day, enforced rather than hoped for. The client
-- used to check the last row's date before inserting, which two open tabs or a
-- reload could both pass. Partial, so the unattributable legacy rows — which
-- share a NULL account_id — are not forced into conflict with each other.
CREATE UNIQUE INDEX IF NOT EXISTS portfolio_snapshots_one_per_account_day
  ON public.portfolio_snapshots (user_id, account_id, snapshot_date)
  WHERE account_id IS NOT NULL AND snapshot_date IS NOT NULL;

-- The common read: one account's series, oldest first.
CREATE INDEX IF NOT EXISTS portfolio_snapshots_account_date_idx
  ON public.portfolio_snapshots (account_id, snapshot_date);
