-- Alerts persisted, with acknowledgement (§23.1, §16.1 `alerts`).
--
-- `raiseAlerts()` (lib/alerts.ts) computes everything wanting attention on
-- every render of the dashboard, and forgets it on the next. Nothing records
-- when a condition first appeared, how long it has held, or that the holder
-- has seen it — so a margin breach that has stood for a week reads exactly
-- like one that appeared this morning, and there is no way to say "seen".
--
-- This table is the record. The app still COMPUTES alerts; the table holds
-- their lifecycle:
--
--   raised     — first_raised_at, and last_raised_at on every re-evaluation
--   resolved   — a re-evaluation that no longer includes it sets resolved_at
--   re-raised  — a resolved alert that comes back is a NEW occurrence:
--                first_raised_at resets, and so does the acknowledgement
--   acknowledged — the holder's "seen", acknowledged_at; never the app's
--
-- IDENTITY is the fingerprint: the type and the message with figures blanked
-- (lib side), so "positions last imported 3 days ago" and "… 4 days ago" are
-- one alert whose wording moved, not two alerts. Scoped per account or to the
-- household (`account_id` NULL), because the same condition on two accounts
-- is two alerts.
--
-- `raise_alerts()` is the one write path: it upserts the incoming set and
-- resolves whatever the set no longer contains, in one call, as the invoker,
-- under RLS. The client never decides what is new, re-raised or resolved —
-- the database compares and says.
--
-- `record_change()` is replaced whole to raise `AlertRaised` (§19.1) on an
-- insert and on a re-raise, so the fourteenth event name in the CHECK now has
-- a source. Everything else in the function is as 20260917150000 wrote it.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--
-- It changes no alert rule. Which conditions raise is `lib/alerts.ts`'s and
-- stays there; the table records outcomes, it does not evaluate anything.
--
-- It does not silence an acknowledged alert. Acknowledged is a fact about
-- the holder, shown as such; the condition is still true and still shown.
--
-- Idempotent throughout, like the ledger and events migrations.

CREATE TABLE IF NOT EXISTS public.alerts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  -- The scope the alert was raised for. NULL = the household view.
  account_id       UUID REFERENCES public.accounts (id) ON DELETE CASCADE,
  -- The NULL-safe scope, for the uniqueness the table needs: two NULLs are
  -- never equal to Postgres, and "the household" is one scope, not many.
  scope_key        TEXT GENERATED ALWAYS AS (COALESCE(account_id::text, 'household')) STORED,
  type             TEXT NOT NULL,
  severity         TEXT NOT NULL,
  message          TEXT NOT NULL,
  href             TEXT NOT NULL,
  fingerprint      TEXT NOT NULL,
  first_raised_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_raised_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL while the condition holds.
  resolved_at      TIMESTAMPTZ,
  -- NULL until the holder says "seen". Cleared on re-raise.
  acknowledged_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alerts_vocabulary') THEN
    ALTER TABLE public.alerts
      ADD CONSTRAINT alerts_vocabulary
      CHECK (
        -- The eleven §23.1 names, as `lib/alerts.ts` lists them.
        type IN (
          'data_source_failure', 'stale_quote', 'missing_valuation', 'event_proximity',
          'goal_pace', 'concentration_breach', 'margin_threshold', 'decision_trigger',
          'invalidation_reached', 'reconciliation_needed', 'model_health'
        )
        AND severity IN ('critical', 'warning', 'info')
        AND btrim(message) <> ''
        AND btrim(fingerprint) <> ''
        AND btrim(href) <> ''
        AND last_raised_at >= first_raised_at
        AND (resolved_at IS NULL OR resolved_at >= first_raised_at)
        AND (acknowledged_at IS NULL OR acknowledged_at >= first_raised_at)
      );
  END IF;
END $$;

-- One row per condition per scope per user. The identity the RPC upserts on.
CREATE UNIQUE INDEX IF NOT EXISTS alerts_identity
  ON public.alerts (user_id, scope_key, fingerprint);
CREATE INDEX IF NOT EXISTS alerts_open_idx
  ON public.alerts (user_id, scope_key) WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- raise_alerts(): the one write path
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.raise_alerts(
  p_account_id UUID,
  p_alerts     JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user     UUID := auth.uid();
  v_scope    TEXT := COALESCE(p_account_id::text, 'household');
  v_a        JSONB;
  v_fps      TEXT[];
  v_existing public.alerts%ROWTYPE;
  v_raised   INT := 0;
  v_reraised INT := 0;
  v_refreshed INT := 0;
  v_resolved INT := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  IF jsonb_typeof(p_alerts) <> 'array' THEN
    RAISE EXCEPTION 'p_alerts must be a JSON array';
  END IF;
  IF p_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounts WHERE id = p_account_id AND user_id = v_user
  ) THEN
    RAISE EXCEPTION 'Account % does not belong to the signed-in user', p_account_id;
  END IF;

  SELECT COALESCE(array_agg(a->>'fingerprint'), ARRAY[]::TEXT[])
    INTO v_fps
    FROM jsonb_array_elements(p_alerts) AS a;

  FOR v_a IN SELECT * FROM jsonb_array_elements(p_alerts)
  LOOP
    SELECT * INTO v_existing
      FROM public.alerts
     WHERE user_id = v_user AND scope_key = v_scope AND fingerprint = v_a->>'fingerprint'
       FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.alerts (user_id, account_id, type, severity, message, href, fingerprint)
      VALUES (v_user, p_account_id, v_a->>'type', v_a->>'severity', v_a->>'message', v_a->>'href', v_a->>'fingerprint');
      v_raised := v_raised + 1;
    ELSIF v_existing.resolved_at IS NOT NULL THEN
      -- A NEW occurrence of a condition that had gone away. The holder's
      -- earlier "seen" was about the earlier occurrence.
      UPDATE public.alerts
         SET severity = v_a->>'severity', message = v_a->>'message', href = v_a->>'href',
             first_raised_at = now(), last_raised_at = now(),
             resolved_at = NULL, acknowledged_at = NULL, updated_at = now()
       WHERE id = v_existing.id;
      v_reraised := v_reraised + 1;
    ELSE
      -- Still raised: the wording may have moved (a count, a percentage);
      -- the occurrence and its acknowledgement have not.
      UPDATE public.alerts
         SET severity = v_a->>'severity', message = v_a->>'message', href = v_a->>'href',
             last_raised_at = now(), updated_at = now()
       WHERE id = v_existing.id;
      v_refreshed := v_refreshed + 1;
    END IF;
  END LOOP;

  -- Whatever this evaluation did not raise, and was open, has resolved.
  UPDATE public.alerts
     SET resolved_at = now(), updated_at = now()
   WHERE user_id = v_user AND scope_key = v_scope AND resolved_at IS NULL
     AND fingerprint <> ALL (v_fps);
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  RETURN jsonb_build_object(
    'raised', v_raised, 'reraised', v_reraised, 'refreshed', v_refreshed, 'resolved', v_resolved
  );
END $$;

REVOKE ALL ON FUNCTION public.raise_alerts(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.raise_alerts(UUID, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- record_change(): replaced whole, with the alerts branch added
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
  v_user := (v_row->>'user_id')::UUID;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'record_change: % has no user_id; refusing to write an ownerless audit row', TG_TABLE_NAME;
  END IF;
  v_row_id := (v_row->>'id')::UUID;
  v_account := CASE WHEN v_row ? 'account_id' THEN (v_row->>'account_id')::UUID ELSE NULL END;

  INSERT INTO public.audit_log (user_id, table_name, row_id, op, old_row, new_row, changed_by)
  VALUES (v_user, TG_TABLE_NAME, v_row_id, TG_OP, v_old, v_new, auth.uid())
  RETURNING id INTO v_audit_id;

  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::TEXT[])
      INTO v_changed
      FROM jsonb_object_keys(v_new) AS k
     WHERE k <> 'updated_at'
       AND v_new->k IS DISTINCT FROM v_old->k;
  END IF;

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
    -- New occurrence only: an insert, or a resolved alert coming back. A
    -- refresh (the wording moved) and an acknowledgement raise nothing.
    WHEN 'alerts' THEN
      CASE
        WHEN TG_OP = 'INSERT' THEN 'AlertRaised'
        WHEN TG_OP = 'UPDATE' AND v_old->>'resolved_at' IS NOT NULL AND v_new->>'resolved_at' IS NULL
          THEN 'AlertRaised'
      END
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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_alerts_record_change') THEN
    CREATE TRIGGER trg_alerts_record_change
      AFTER INSERT OR UPDATE OR DELETE ON public.alerts
      FOR EACH ROW EXECUTE FUNCTION public.record_change();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_alerts_updated') THEN
    CREATE TRIGGER trg_alerts_updated
      BEFORE UPDATE ON public.alerts
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON public.alerts TO authenticated;
GRANT ALL ON public.alerts TO service_role;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'alerts' AND policyname = 'own alerts') THEN
    CREATE POLICY "own alerts" ON public.alerts
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

COMMENT ON TABLE public.alerts IS
  'The lifecycle of each computed alert (§23.1): first raised, last raised, resolved, acknowledged. raise_alerts() is the one write path for raising and resolving; acknowledged_at is the holder''s own update. The rules that raise live in lib/alerts.ts, not here.';
COMMENT ON COLUMN public.alerts.fingerprint IS
  'Identity across evaluations: the type and the message with figures blanked, so a moving count is one alert whose wording changed.';
COMMENT ON COLUMN public.alerts.acknowledged_at IS
  'The holder''s "seen". NULL until set; cleared when a resolved alert re-raises, because that is a new occurrence.';