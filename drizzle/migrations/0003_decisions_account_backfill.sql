-- Backfill `decisions.account_id` on rows written before the column existed
-- (ADR-APP-019, decided 2026-09-18; DEC-005).
--
-- `account_id` arrived on 2026-09-12 and has been stamped by the Committee's
-- write path since #226. Earlier rows carry NULL, and a decision with no
-- account cannot be superseded (DEC-005's supersession chain is per account).
--
-- THE RULE: deterministic or nothing. A user who has EXACTLY ONE account gets
-- every NULL row attached to it — no other answer is possible. A user with
-- two or more accounts gets no backfill: choosing one would be a guess about
-- which account a past recommendation concerned, and a guessed account on a
-- governed decision is worse than none. A user with no account has nothing to
-- attach to. Rows left NULL are counted in the NOTICE and stay as history.
--
-- Idempotent: a second run finds no NULL rows for one-account users and
-- changes nothing. `record_change()` fires per updated row and writes the
-- audit trail under the row's owner (changed_by NULL: no signed-in user runs
-- a migration).

DO $$
DECLARE
  v_moved INT := 0;
  v_left  INT := 0;
BEGIN
  WITH single_account AS (
    -- Exactly one row per group (HAVING below), so the first is the only.
    SELECT user_id, (array_agg(id))[1] AS account_id
      FROM public.accounts
     GROUP BY user_id
    HAVING count(*) = 1
  )
  UPDATE public.decisions d
     SET account_id = s.account_id
    FROM single_account s
   WHERE d.user_id = s.user_id
     AND d.account_id IS NULL;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  SELECT count(*) INTO v_left FROM public.decisions WHERE account_id IS NULL;

  RAISE NOTICE 'decisions.account_id backfill (ADR-APP-019): % rows attached to the user''s only account; % rows left NULL (owners with zero or several accounts, kept as history).', v_moved, v_left;
END $$;