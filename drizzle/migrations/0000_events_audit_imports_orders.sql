-- The event record, the audit record, the import batch, and the order links
-- the blueprint's ledger still lacked (§19, §20.2, §12.1–12.2, SYS-004, §24).
--
-- Four absences, each of which shows up as a wrong or unanswerable question
-- rather than as a missing feature:
--
--   1. NO AUDIT LOG (SYS-004, §24). A change to `ips_lite` — the risk caps the
--      committee is told are the user's HARD GOVERNANCE — leaves `updated_at`
--      and nothing else. Which cap changed, from what, and when, cannot be
--      answered. The same for a goal version, a decision, an order, a fill.
--
--   2. NO EVENT RECORD (§19). "After a sale, rerank the universe" (BR-004),
--      "outcome measurement begins" (§A.3), "dependent caches invalidated"
--      (§A.2) are all consequences of events the app never records. V1 may
--      implement them as durable outbox rows rather than Kafka (§19.2); it
--      has not implemented them at all.
--
--   3. NO IMPORT BATCH (§20.2). An import writes holdings and a `sync_log`
--      line. The file it came from, its checksum, how many rows it carried
--      and what the diff was are gone once the toast closes, so "reimport of
--      the same state is idempotent" (IMP-004) cannot be checked against
--      anything.
--
--   4. ORDERS CANNOT SAY WHICH DECISION OR TRANCHE THEY SERVE (§12.2), and
--      cannot be UNTRIGGERED (a stop that has not fired — working, not open)
--      or SUPERSEDED (replaced by another order without being cancelled).
--      §A.3's chain from decision to execution has no column to run along.
--
-- ONE TRIGGER FUNCTION, TWO TARGETS. `record_change()` writes an `audit_log`
-- row for every insert, update and delete on the material tables, and — where
-- the change is one of the fourteen named events — a `domain_events` row that
-- points back at the audit row. The audit row is the evidence; the event is
-- the consequence waiting to be consumed. SECURITY DEFINER, so the two tables
-- need no write grant to `authenticated`: nothing but the trigger writes them.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--
-- It records no consumer. Nothing yet reads `domain_events`; `consumed_at`
-- stays NULL until a consumer exists (Phase 2: rerank on TrancheClosed,
-- outcome measurement on DecisionCreated). The record is the deliverable —
-- an event that was never written cannot be replayed once a consumer arrives.
--
-- It does not backfill. Rows that exist today have no audit history; their
-- first audit row is their next change. Inventing "INSERT" rows dated `now()`
-- for old data would stamp a fabricated time on every one.
--
-- It does not change the import RPC. `import_batches` is written by the app
-- before the RPC runs and `sync_log.batch_id` after; the RPC's signature is
-- untouched so the deployed client keeps working through the deploy.
--
-- It does not add DRAFT / PROPOSED / ACCEPTED to orders. Those are decision
-- states in this app (`decisions.decision`), and whether they also belong on
-- orders is the owner's call (ADR-008).
--
-- Idempotent throughout (IF NOT EXISTS), like the ledger migration, because
-- Lovable has applied files under its own names before.

-- ---------------------------------------------------------------------------
-- audit_log (SYS-004, §24)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.audit_log (
  id          BIGSERIAL PRIMARY KEY,
  -- The OWNER of the row that changed, read from the row itself. Every
  -- audited table carries `user_id`; the trigger refuses to run on one that
  -- does not, rather than writing an ownerless line nobody can read back.
  user_id     UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  table_name  TEXT NOT NULL,
  row_id      UUID NOT NULL,
  op          TEXT NOT NULL,
  -- The row before and after, whole. NULL before an insert, NULL after a
  -- delete. Whole rather than a diff, because a diff is derivable from two
  -- rows and two rows are not derivable from a diff.
  old_row     JSONB,
  new_row     JSONB,
  -- Who made the change: `auth.uid()` at the time, NULL when the write came
  -- from the service role or a job. Distinct from `user_id` — the owner —
  -- because the two differ exactly when it matters.
  changed_by  UUID,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_log_op') THEN
    ALTER TABLE public.audit_log
      ADD CONSTRAINT audit_log_op CHECK (op IN ('INSERT', 'UPDATE', 'DELETE'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS audit_log_row_idx ON public.audit_log (table_name, row_id, changed_at);
CREATE INDEX IF NOT EXISTS audit_log_user_idx ON public.audit_log (user_id, changed_at);

-- ---------------------------------------------------------------------------
-- domain_events (§19.1, §19.2)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.domain_events (
  id             BIGSERIAL PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  -- One of the fourteen names in §19.1, verbatim. The CHECK below is the
  -- contract §19.2 asks to preserve.
  event_type     TEXT NOT NULL,
  -- The row the event is about: its table and id, and its account where the
  -- row has one, so a consumer can scope without a join.
  aggregate_type TEXT NOT NULL,
  aggregate_id   UUID NOT NULL,
  account_id     UUID,
  -- What a consumer needs beyond the ids. For an update, the columns that
  -- changed; never the whole row, which the audit row already holds.
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- The write that raised it. SET NULL rather than CASCADE: an event whose
  -- evidence was pruned is still an event that happened.
  audit_id       BIGINT REFERENCES public.audit_log (id) ON DELETE SET NULL,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL until a consumer has handled it. The outbox half of §19.2.
  consumed_at    TIMESTAMPTZ
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'domain_events_type') THEN
    ALTER TABLE public.domain_events
      ADD CONSTRAINT domain_events_type
      CHECK (event_type IN (
        'AccountImported', 'HoldingsReconciled', 'QuoteUpdated', 'ValuationCompleted',
        'GoalChanged', 'PolicyChanged', 'DecisionCreated', 'DecisionAccepted',
        'OrderOpened', 'FillRecorded', 'TrancheClosed', 'OutcomeMeasured',
        'ModelEvaluated', 'AlertRaised'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS domain_events_unconsumed_idx
  ON public.domain_events (occurred_at) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS domain_events_aggregate_idx
  ON public.domain_events (aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS domain_events_user_type_idx
  ON public.domain_events (user_id, event_type, occurred_at);

-- ---------------------------------------------------------------------------
-- record_change(): the one trigger function
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old      JSONB := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_new      JSONB := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  v_row      JSONB := COALESCE(v_new, v_old);
  v_user     UUID;
  v_row_id   UUID;
  v_audit_id BIGINT;
  v_event    TEXT := NULL;
  v_changed  TEXT[];
  v_account  UUID;
BEGIN
  -- Ownership from the row, not from the session: a service-role write has
  -- no `auth.uid()` and the row still belongs to somebody.
  v_user := (v_row->>'user_id')::UUID;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'record_change: % has no user_id; refusing to write an ownerless audit row', TG_TABLE_NAME;
  END IF;
  v_row_id := (v_row->>'id')::UUID;
  v_account := CASE WHEN v_row ? 'account_id' THEN (v_row->>'account_id')::UUID ELSE NULL END;

  INSERT INTO public.audit_log (user_id, table_name, row_id, op, old_row, new_row, changed_by)
  VALUES (v_user, TG_TABLE_NAME, v_row_id, TG_OP, v_old, v_new, auth.uid())
  RETURNING id INTO v_audit_id;

  -- Which columns changed, for an update. `updated_at` is excluded: it
  -- changes on every update by trigger and says nothing.
  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::TEXT[])
      INTO v_changed
      FROM jsonb_object_keys(v_new) AS k
     WHERE k <> 'updated_at'
       AND v_new->k IS DISTINCT FROM v_old->k;
  END IF;

  -- Which of the fourteen events this change is, if any. The mapping is the
  -- whole reason the function is one function: it is written once, here.
  v_event := CASE TG_TABLE_NAME
    WHEN 'holdings' THEN
      CASE
        WHEN TG_OP = 'UPDATE'
             AND v_changed <@ ARRAY['current_price', 'last_price_at']::TEXT[]
             AND array_length(v_changed, 1) IS NOT NULL
          THEN 'QuoteUpdated'
        ELSE 'HoldingsReconciled'
      END
    WHEN 'accounts' THEN
      CASE WHEN TG_OP = 'UPDATE' AND 'last_synced_at' = ANY(v_changed) THEN 'AccountImported' END
    WHEN 'ips_lite' THEN
      CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN 'PolicyChanged' END
    WHEN 'goal_versions' THEN
      CASE WHEN TG_OP = 'INSERT' THEN 'GoalChanged' END
    WHEN 'decisions' THEN
      CASE
        WHEN TG_OP = 'INSERT' THEN 'DecisionCreated'
        -- 'followed' is this app's word for an accepted recommendation
        -- (`decisions.decision`). A rejection or a deferral is not an
        -- acceptance and raises nothing.
        WHEN TG_OP = 'UPDATE' AND v_old->>'decision' IS DISTINCT FROM 'followed'
             AND v_new->>'decision' = 'followed' THEN 'DecisionAccepted'
        WHEN TG_OP = 'UPDATE'
             AND v_changed && ARRAY['outcome_1d', 'outcome_1w', 'outcome_1m', 'outcome_pl', 'outcome', 'grade']::TEXT[]
          THEN 'OutcomeMeasured'
      END
    WHEN 'orders' THEN
      CASE WHEN TG_OP = 'INSERT' THEN 'OrderOpened' END
    WHEN 'fills' THEN
      CASE WHEN TG_OP = 'INSERT' THEN 'FillRecorded' END
    WHEN 'tranches' THEN
      CASE WHEN TG_OP = 'UPDATE' AND v_old->>'closed_at' IS NULL AND v_new->>'closed_at' IS NOT NULL
        THEN 'TrancheClosed' END
    WHEN 'portfolio_snapshots' THEN
      CASE WHEN TG_OP = 'INSERT' THEN 'ValuationCompleted' END
    ELSE NULL
  END;

  IF v_event IS NOT NULL THEN
    INSERT INTO public.domain_events (user_id, event_type, aggregate_type, aggregate_id, account_id, payload, audit_id)
    VALUES (
      v_user, v_event, TG_TABLE_NAME, v_row_id, v_account,
      jsonb_build_object('op', TG_OP, 'changed', to_jsonb(COALESCE(v_changed, ARRAY[]::TEXT[]))),
      v_audit_id
    );
  END IF;

  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.record_change() FROM PUBLIC;

-- Attached AFTER, FOR EACH ROW, to every material table. AFTER, so a write
-- the table's own CHECKs refuse leaves no audit line claiming it happened.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounts', 'ips_lite', 'goal_versions', 'decisions',
    'orders', 'fills', 'tranches', 'holdings', 'portfolio_snapshots'
  ]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || t || '_record_change') THEN
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.record_change()',
        'trg_' || t || '_record_change', t
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- import_batches (§20.2, IMP-004)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.import_batches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  -- The account the batch was committed to. NULL while staged and until the
  -- holder has chosen one, which is a real state of the import screen.
  account_id       UUID REFERENCES public.accounts (id) ON DELETE SET NULL,
  -- Which adapter read it. The same vocabulary as `orders.execution_source`
  -- and `accounts.balances_source`: no AI value.
  source           TEXT NOT NULL,
  file_name        TEXT,
  file_size_bytes  BIGINT,
  -- SHA-256 of the file as received, hex. What makes "the same file twice"
  -- a fact rather than a guess from row counts.
  checksum_sha256  TEXT,
  -- Row counts at each step of §20.2. NULL = that step did not run.
  parsed_rows      INTEGER,
  valid_rows       INTEGER,
  -- What the commit would do / did: the preview's own shape
  -- (`importSafety.previewImport`), stored as given.
  diff             JSONB,
  -- The reconciliation result after commit, where one was run.
  reconciliation   JSONB,
  outcome          TEXT NOT NULL,
  error            TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_batches_bounds') THEN
    ALTER TABLE public.import_batches
      ADD CONSTRAINT import_batches_bounds
      CHECK (
        source IN ('imported', 'user_entry')
        -- 'staged' is the state between upload and confirm; a batch left there
        -- is one the holder walked away from, and that is worth knowing.
        AND outcome IN ('staged', 'committed', 'failed', 'cancelled')
        AND (file_size_bytes IS NULL OR file_size_bytes >= 0)
        AND (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$')
        AND (parsed_rows IS NULL OR parsed_rows >= 0)
        AND (valid_rows IS NULL OR valid_rows >= 0)
        AND (finished_at IS NULL OR finished_at >= started_at)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS import_batches_user_idx ON public.import_batches (user_id, started_at);
-- IMP-004 at the index: the same file committed twice to one account is
-- findable in one lookup.
CREATE INDEX IF NOT EXISTS import_batches_checksum_idx
  ON public.import_batches (account_id, checksum_sha256) WHERE checksum_sha256 IS NOT NULL;

-- The line `sync_log` already writes per import gains the batch it belongs
-- to. Nullable: every existing line predates batches.
ALTER TABLE public.sync_log
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.import_batches (id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- orders: decision and tranche links, and two more states (§12.1, §12.2)
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS decision_id UUID REFERENCES public.decisions (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tranche_id  UUID REFERENCES public.tranches (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orders_decision_idx ON public.orders (decision_id) WHERE decision_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_tranche_idx  ON public.orders (tranche_id)  WHERE tranche_id  IS NOT NULL;

-- The vocabulary CHECK is replaced whole rather than amended, because a CHECK
-- cannot be altered in place. Same clauses as 20260905280000, plus
-- 'untriggered' (a stop or conditional order the broker holds but has not
-- activated — committed, not open) and 'superseded' (replaced by another
-- order without being cancelled — DEC-005's word, applied to orders).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_vocabulary'
      AND pg_get_constraintdef(oid) LIKE '%''untriggered''%'
  ) THEN
    ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_vocabulary;
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_vocabulary
      CHECK (
        btrim(symbol) <> ''
        AND side IN ('buy', 'sell', 'sell_short', 'buy_to_cover')
        AND order_type IN ('market', 'limit', 'stop', 'stop_limit', 'trailing_stop', 'other')
        AND status IN (
          'pending_new', 'open', 'partially_filled', 'filled',
          'cancelled', 'rejected', 'expired', 'unknown',
          'untriggered', 'superseded'
        )
        AND (time_in_force IS NULL
             OR time_in_force IN ('day', 'gtc', 'ioc', 'fok', 'opg', 'cls', 'other'))
        AND execution_source IN ('imported', 'user_entry')
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------

-- Read your own audit and event rows; write neither. The trigger writes them
-- as its definer. A consumer marks an event handled — that is the one column
-- `authenticated` may change.
GRANT SELECT ON public.audit_log TO authenticated;
GRANT SELECT, UPDATE (consumed_at) ON public.domain_events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.audit_log_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.domain_events_id_seq TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_batches TO authenticated;
GRANT ALL ON public.audit_log, public.domain_events, public.import_batches TO service_role;
GRANT ALL ON SEQUENCE public.audit_log_id_seq, public.domain_events_id_seq TO service_role;

ALTER TABLE public.audit_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_log' AND policyname = 'own audit rows') THEN
    CREATE POLICY "own audit rows" ON public.audit_log
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'domain_events' AND policyname = 'own events') THEN
    CREATE POLICY "own events" ON public.domain_events
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'domain_events' AND policyname = 'consume own events') THEN
    CREATE POLICY "consume own events" ON public.domain_events
      FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'import_batches' AND policyname = 'own import batches') THEN
    CREATE POLICY "own import batches" ON public.import_batches
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

COMMENT ON TABLE public.audit_log IS
  'Every insert, update and delete on the material tables, whole rows before and after (SYS-004, §24). Written only by record_change(); readable by the row''s owner.';
COMMENT ON TABLE public.domain_events IS
  'The fourteen §19.1 domain events as durable outbox rows (§19.2). Raised by record_change() from the write that caused them; consumed_at is NULL until a consumer handles one. No consumer exists yet — the record is kept so one can replay.';
COMMENT ON TABLE public.import_batches IS
  'One row per import: file, checksum, counts, diff, outcome (§20.2). What makes a repeated import recognisable as the same file (IMP-004).';
COMMENT ON COLUMN public.orders.decision_id IS
  'The decision this order executes (§12.2, §A.3). NULL for an order nobody linked. SET NULL on delete: the order happened whether or not the decision survives.';
COMMENT ON COLUMN public.orders.tranche_id IS
  'The tranche this order opens or closes (§12.2, BR-010). NULL for an order nobody linked.';