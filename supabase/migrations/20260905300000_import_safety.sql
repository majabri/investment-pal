-- Import safety (Phase 6, rule 29).
--
-- "Account-scoped, validated, previewed, atomic, auditable, idempotent where
-- appropriate. An import to one account must not touch another. A failed
-- import must not leave half-written financial data. THESES, NOTES, DECISIONS
-- AND HISTORY MUST SURVIVE A POSITION REFRESH."
--
-- The Portfolio CSV import violates three of those today, and the last one is
-- silent data loss shipping in production:
--
-- 1. NOT ATOMIC. It loops over accounts doing DELETE-then-INSERT with no
--    transaction. A failure between the two leaves that account with NO
--    POSITIONS AT ALL, and every account after it untouched — a portfolio in
--    two states, one of them empty, with a toast saying the save failed.
--
-- 2. THESES DO NOT SURVIVE. `original_thesis`, `current_thesis`, `why_own`,
--    `notes`, `sector`, `last_ai_review` and `last_reviewed_at` live on the
--    holdings row. DELETE-then-INSERT drops all of them, for every symbol, on
--    every import. Rule 29 names this exactly. Somebody's reason for owning a
--    position is not recoverable from a broker export.
--
-- 3. UNKNOWN CASH IS WRITTEN AS ZERO. The caller sums `cashByAccount[label]
--    ?? 0`, and the parser only creates a key when the CSV carried a cash
--    line — so an account whose export had none is written to as holding
--    exactly $0.00. That is the Phase 1a defect, still live in the one path
--    that writes money most often.
--
-- This function fixes all three by being the only way positions are written:
-- one call per account, atomic by construction, preserving the narrative
-- columns, and treating a NULL cash argument as "do not write" rather than as
-- zero.
--
-- SECURITY INVOKER, so RLS applies as it does everywhere else. The explicit
-- ownership check is belt and braces: it turns a cross-account write into a
-- loud error rather than a silent no-op under RLS, which matters because the
-- caller is deciding which account a CSV block belongs to.
--
-- Money-adjacent under OD-001: this writes positions and cash. The
-- arithmetic is the caller's and unchanged — what changes is that a failure
-- can no longer leave half of it written, and that unknown stays unknown.
-- Merged under the master brief's standing instruction to self-merge on a
-- green gate, called out rather than merged silently.
CREATE OR REPLACE FUNCTION public.import_account_positions(
  p_account_id UUID,
  -- [{ "symbol": "MSFT", "quantity": 1.5, "cost_basis": 300, "current_price": 400 }]
  p_rows       JSONB,
  -- NULL = the import did not carry a cash figure. NOT zero (rule 13).
  p_cash       NUMERIC,
  p_as_of      TIMESTAMPTZ,
  p_source     TEXT DEFAULT 'imported'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user     UUID := auth.uid();
  v_owner    UUID;
  v_symbols  TEXT[];
  v_row      JSONB;
  v_updated  INT := 0;
  v_inserted INT := 0;
  v_removed  INT := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  SELECT user_id INTO v_owner FROM public.accounts WHERE id = p_account_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'No such account: %', p_account_id;
  END IF;
  -- Rule 29's "an import to one account must not touch another", enforced
  -- rather than intended.
  IF v_owner <> v_user THEN
    RAISE EXCEPTION 'Account % does not belong to the signed-in user', p_account_id;
  END IF;

  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array';
  END IF;

  SELECT array_agg(upper(btrim(r->>'symbol')))
    INTO v_symbols
    FROM jsonb_array_elements(p_rows) AS r
   WHERE btrim(coalesce(r->>'symbol', '')) <> '';

  v_symbols := coalesce(v_symbols, ARRAY[]::TEXT[]);

  -- UPDATE-then-INSERT rather than DELETE-then-INSERT. This is the whole
  -- point: the narrative columns are simply not in the SET list, so they
  -- survive untouched. `original_thesis`, `current_thesis`, `why_own`,
  -- `notes`, `sector`, `last_ai_review` and `last_reviewed_at` are the
  -- columns rule 29 is about, and none of them appears below.
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    CONTINUE WHEN btrim(coalesce(v_row->>'symbol', '')) = '';

    UPDATE public.holdings
       SET quantity      = (v_row->>'quantity')::NUMERIC,
           cost_basis    = (v_row->>'cost_basis')::NUMERIC,
           current_price = (v_row->>'current_price')::NUMERIC,
           last_price_at = p_as_of,
           updated_at    = now()
     WHERE user_id    = v_user
       AND account_id = p_account_id
       AND symbol     = upper(btrim(v_row->>'symbol'));

    IF FOUND THEN
      v_updated := v_updated + 1;
    ELSE
      INSERT INTO public.holdings
        (user_id, account_id, symbol, quantity, cost_basis, current_price, last_price_at)
      VALUES
        (v_user, p_account_id, upper(btrim(v_row->>'symbol')),
         (v_row->>'quantity')::NUMERIC,
         (v_row->>'cost_basis')::NUMERIC,
         (v_row->>'current_price')::NUMERIC,
         p_as_of);
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  -- Positions the export no longer carries are gone from the account. Scoped
  -- to THIS account: the old code's `fullOverwrite` deleted every holding the
  -- user had, including accounts the import was not even mapping.
  DELETE FROM public.holdings
   WHERE user_id    = v_user
     AND account_id = p_account_id
     AND symbol <> ALL (v_symbols);
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  UPDATE public.accounts
     SET -- NULL cash means the import carried no cash figure. Leaving the
         -- column alone is the honest action; writing 0 is the Phase 1a
         -- defect, and writing NULL would erase a figure the user may have
         -- entered by hand.
         cash                = COALESCE(p_cash, cash),
         last_synced_at      = p_as_of,
         balances_source_type = CASE WHEN p_cash IS NULL THEN balances_source_type
                                     ELSE 'imported_snapshot' END,
         balances_source      = CASE WHEN p_cash IS NULL THEN balances_source
                                     ELSE p_source END,
         balances_as_of       = CASE WHEN p_cash IS NULL THEN balances_as_of
                                     ELSE p_as_of END,
         updated_at           = now()
   WHERE id = p_account_id AND user_id = v_user;

  -- Auditable (rule 29): what happened, in the caller's hands, so a toast can
  -- say it and a log can record it rather than the user inferring it.
  RETURN jsonb_build_object(
    'account_id', p_account_id,
    'updated',    v_updated,
    'inserted',   v_inserted,
    'removed',    v_removed,
    'cash_written', p_cash IS NOT NULL
  );
END $$;

REVOKE ALL ON FUNCTION public.import_account_positions(UUID, JSONB, NUMERIC, TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_account_positions(UUID, JSONB, NUMERIC, TIMESTAMPTZ, TEXT) TO authenticated;

COMMENT ON FUNCTION public.import_account_positions(UUID, JSONB, NUMERIC, TIMESTAMPTZ, TEXT) IS
  'Atomic, account-scoped position import (rule 29). UPDATE-then-INSERT so theses, notes and history survive a refresh; deletes only symbols absent from THIS import for THIS account; a NULL cash argument leaves the column alone rather than writing zero.';
