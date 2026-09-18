-- Per-consumer cursors over domain_events (ADR-APP-018, decided 2026-09-18:
-- option 2, "cursor"; §19.2).
--
-- WHY. `domain_events` (20260917150000) is a durable outbox with ONE
-- `consumed_at`. Whoever set it first would hide the event from every later
-- consumer: a cache-invalidation consumer marking GoalChanged consumed would
-- hide it from the goal-change cascade. Nothing consumes yet, so this is the
-- cheap moment to give every consumer its own place to stand.
--
-- WHAT. `event_consumers (user_id, name, last_event_id)`: one row per consumer
-- per owner. A consumer reads events with `id > its cursor`, handles them,
-- then advances its own cursor through `advance_event_cursor()`. Two rules the
-- function holds: the cursor never moves backwards, and it never moves past an
-- event that does not exist. `consumed_at` keeps a meaning — it is set once
-- EVERY registered consumer of the owner has passed the event (the minimum
-- cursor), so the activity panel's "consumed" reading stays true. A consumer
-- that registers starts at the present: the events before it registered are
-- history it never asked for, and it passes them by declaration. A consumer
-- that wants history (outcome measurement, one day) is seeded by its own
-- migration at the cursor it wants.
--
-- ONE WRITE PATH. The client role keeps SELECT on `event_consumers` and loses
-- the direct `UPDATE (consumed_at)` on `domain_events` that 20260918170000
-- left it: both columns are now written only by the two SECURITY DEFINER
-- functions below, which scope to `auth.uid()` themselves. Production grants
-- ALL to `anon` and `authenticated` at table creation (confirmed 2026-09-18),
-- so REVOKE ALL first, then GRANT (#250).
--
-- WHAT THIS DELIBERATELY DOES NOT DO. It registers no consumer and consumes
-- nothing (ADR-018: seed rows none). The first consumer — GoalChanged → the
-- goal-derived caches — is wired in the app AFTER Lovable applies this and
-- regenerates the types: migration first, wiring second. It does not drop
-- `consumed_at`, and it does not touch `record_change()`.
--
-- Idempotent throughout (IF NOT EXISTS / OR REPLACE), like every migration
-- since the ledger, because Lovable has applied files under its own names.

CREATE TABLE IF NOT EXISTS public.event_consumers (
  user_id       UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  -- The consumer's name, as the app's constant spells it. Lower snake_case.
  name          TEXT NOT NULL,
  -- The last domain_events.id this consumer has passed. 0 = none.
  last_event_id BIGINT NOT NULL DEFAULT 0,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, name)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_consumers_name') THEN
    ALTER TABLE public.event_consumers
      ADD CONSTRAINT event_consumers_name CHECK (name ~ '^[a-z][a-z0-9_]{1,62}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_consumers_cursor') THEN
    ALTER TABLE public.event_consumers
      ADD CONSTRAINT event_consumers_cursor CHECK (last_event_id >= 0);
  END IF;
END $$;

ALTER TABLE public.event_consumers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'event_consumers' AND policyname = 'own consumers') THEN
    -- SELECT only. Every write is a function below.
    CREATE POLICY "own consumers" ON public.event_consumers
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

REVOKE ALL ON TABLE public.event_consumers FROM anon, authenticated;
GRANT SELECT ON TABLE public.event_consumers TO authenticated;

-- The direct consume path closes: the function is the one writer.
REVOKE UPDATE ON TABLE public.domain_events FROM authenticated;
GRANT SELECT ON TABLE public.domain_events TO authenticated;

-- ---------------------------------------------------------------------------
-- register_event_consumer(name) → the consumer's cursor
-- ---------------------------------------------------------------------------
-- Idempotent: an existing consumer gets its cursor back; a new one is created
-- at the owner's latest event id (0 when there is none) and gets that.

CREATE OR REPLACE FUNCTION public.register_event_consumer(p_name TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user   UUID := auth.uid();
  v_cursor BIGINT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  SELECT last_event_id INTO v_cursor
    FROM public.event_consumers
   WHERE user_id = v_user AND name = p_name;
  IF FOUND THEN
    RETURN v_cursor;
  END IF;

  SELECT COALESCE(max(id), 0) INTO v_cursor
    FROM public.domain_events
   WHERE user_id = v_user;

  INSERT INTO public.event_consumers (user_id, name, last_event_id)
  VALUES (v_user, p_name, v_cursor)
  ON CONFLICT (user_id, name) DO NOTHING;

  -- Re-read rather than trust the value we tried to write: two tabs
  -- registering at once must both get the row that won.
  SELECT last_event_id INTO v_cursor
    FROM public.event_consumers
   WHERE user_id = v_user AND name = p_name;
  RETURN v_cursor;
END $$;

-- ---------------------------------------------------------------------------
-- advance_event_cursor(name, last_event_id) → the cursor after the call
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.advance_event_cursor(p_name TEXT, p_last_event_id BIGINT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user   UUID := auth.uid();
  v_max    BIGINT;
  v_cursor BIGINT;
  v_floor  BIGINT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  IF p_last_event_id IS NULL OR p_last_event_id < 0 THEN
    RAISE EXCEPTION 'advance_event_cursor(%): the cursor must be a non-negative event id', p_name;
  END IF;

  -- Only past events that exist. A cursor beyond the last event would let a
  -- consumer skip events it has not seen yet.
  SELECT COALESCE(max(id), 0) INTO v_max
    FROM public.domain_events
   WHERE user_id = v_user;
  IF p_last_event_id > v_max THEN
    RAISE EXCEPTION 'advance_event_cursor(%): % is past the owner''s last event %; a cursor advances only past events that exist',
      p_name, p_last_event_id, v_max;
  END IF;

  -- Never backwards. GREATEST, so a stale tab replaying an old position
  -- cannot rewind a consumer another tab has already advanced.
  UPDATE public.event_consumers
     SET last_event_id = GREATEST(last_event_id, p_last_event_id),
         updated_at    = now()
   WHERE user_id = v_user AND name = p_name
   RETURNING last_event_id INTO v_cursor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'advance_event_cursor(%): consumer is not registered; call register_event_consumer first', p_name;
  END IF;

  -- consumed_at = every registered consumer of this owner has passed it.
  SELECT min(last_event_id) INTO v_floor
    FROM public.event_consumers
   WHERE user_id = v_user;
  UPDATE public.domain_events
     SET consumed_at = now()
   WHERE user_id = v_user
     AND consumed_at IS NULL
     AND id <= v_floor;

  RETURN v_cursor;
END $$;

REVOKE ALL ON FUNCTION public.register_event_consumer(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_event_consumer(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.advance_event_cursor(TEXT, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_event_cursor(TEXT, BIGINT) TO authenticated;

COMMENT ON TABLE public.event_consumers IS
  'One cursor per consumer per owner over domain_events (ADR-APP-018, option 2). A consumer reads id > last_event_id, handles, then calls advance_event_cursor(); the cursor never moves backwards or past the last event. Client role: SELECT own rows; writes only through register_event_consumer() and advance_event_cursor().';
COMMENT ON COLUMN public.domain_events.consumed_at IS
  'Set by advance_event_cursor() once EVERY registered consumer of the owner has passed the event (the minimum cursor). NULL while any consumer has not. A consumer registering at the present passes the history before it by declaration. Not writable by the client directly since 20260918210000.';
