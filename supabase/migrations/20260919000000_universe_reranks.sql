-- Rerank after a sale; never auto-rebuy the same ticker (BR-004, §9.3;
-- the second domain_events consumer, on the ADR-APP-018 cursor).
--
-- WHAT. When a tranche closes (TrancheClosed in the outbox), the universe is
-- re-ordered and the record kept, and the sold symbol is EXCLUDED from the
-- ranking's top for a window: `investment_universe.excluded_until`. The
-- ranking rule is the app's `rank-v1` (tier, then overall conviction
-- descending, unscored last, then symbol) with one addition — an excluded
-- name sorts after every non-excluded one whatever its tier — and is named
-- `rank-v2` here and in the app so a stored ranking says which rule made it.
--
-- THE WINDOW. `record_universe_rerank(p_event_id, p_exclude_days)` takes the
-- window from the caller; the app passes its constant (30 days, the same
-- span ADR-APP-003 gives a buy-back zone before it expires — chosen as a
-- default the owner can change, not decided by him; recorded in the PR). The
-- function refuses a window outside 1–365 days, and never SHORTENS an
-- exclusion already in force (GREATEST).
--
-- ONE WRITE PATH, IDEMPOTENT. `universe_reranks` is SELECT-only for the
-- client; the function is the writer. One rerank per event (UNIQUE
-- event_id): a second call for the same event returns the first record and
-- changes nothing, so a consumer that retries cannot double-exclude or
-- double-record. The ranking is computed HERE, from the table, not accepted
-- from the client: the record is the database's own answer.
--
-- WHAT IT DELIBERATELY DOES NOT DO. It registers no consumer and consumes
-- nothing (the app's consumer is wired after Lovable applies this and
-- regenerates the types: migration first, wiring second). It does not
-- touch record_change() or the outbox. A sold symbol that is NOT in the
-- universe is recorded as such (in_universe false) — nothing is invented to
-- exclude. Production grants ALL at creation (confirmed 2026-09-18): REVOKE
-- ALL first, then GRANT. Idempotent throughout.

ALTER TABLE public.investment_universe
  ADD COLUMN IF NOT EXISTS excluded_until  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS excluded_reason TEXT;

COMMENT ON COLUMN public.investment_universe.excluded_until IS
  'BR-004: while in the future, the name sorts after every non-excluded name in the ranking (rank-v2) and must not be auto-rebought. Set by record_universe_rerank() on TrancheClosed; never shortened by it.';

CREATE TABLE IF NOT EXISTS public.universe_reranks (
  id             BIGSERIAL PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  -- The TrancheClosed event that triggered it. One rerank per event.
  event_id       BIGINT NOT NULL UNIQUE REFERENCES public.domain_events (id) ON DELETE CASCADE,
  -- The sold symbol, from the tranche the event names.
  symbol         TEXT NOT NULL,
  -- Whether that symbol had a universe row to exclude. FALSE is a fact, not a failure.
  in_universe    BOOLEAN NOT NULL,
  excluded_until TIMESTAMPTZ,
  rank_version   TEXT NOT NULL,
  -- [{rank, symbol, tier, conviction, excluded}], in rank order, as computed here.
  ranking        JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.universe_reranks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'universe_reranks' AND policyname = 'own reranks') THEN
    CREATE POLICY "own reranks" ON public.universe_reranks
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

REVOKE ALL ON TABLE public.universe_reranks FROM anon, authenticated;
GRANT SELECT ON TABLE public.universe_reranks TO authenticated;

CREATE INDEX IF NOT EXISTS universe_reranks_user_created_idx
  ON public.universe_reranks (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- record_universe_rerank(event_id, exclude_days) → the record, as JSON
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_universe_rerank(p_event_id BIGINT, p_exclude_days INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user     UUID := auth.uid();
  v_event    public.domain_events%ROWTYPE;
  v_existing public.universe_reranks%ROWTYPE;
  v_symbol   TEXT;
  v_until    TIMESTAMPTZ;
  v_in       BOOLEAN;
  v_ranking  JSONB;
  v_id       BIGINT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  IF p_exclude_days IS NULL OR p_exclude_days < 1 OR p_exclude_days > 365 THEN
    RAISE EXCEPTION 'record_universe_rerank: the exclusion window must be 1–365 days, not %', p_exclude_days;
  END IF;

  SELECT * INTO v_event FROM public.domain_events WHERE id = p_event_id AND user_id = v_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'record_universe_rerank: event % is not one of the owner''s events', p_event_id;
  END IF;
  IF v_event.event_type <> 'TrancheClosed' THEN
    RAISE EXCEPTION 'record_universe_rerank: event % is %, not TrancheClosed', p_event_id, v_event.event_type;
  END IF;

  -- Idempotent: one rerank per event.
  SELECT * INTO v_existing FROM public.universe_reranks WHERE event_id = p_event_id;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_existing.id, 'symbol', v_existing.symbol, 'in_universe', v_existing.in_universe,
                              'excluded_until', v_existing.excluded_until, 'rank_version', v_existing.rank_version,
                              'names', jsonb_array_length(v_existing.ranking), 'repeated', true);
  END IF;

  SELECT upper(trim(t.symbol)) INTO v_symbol
    FROM public.tranches t
   WHERE t.id = v_event.aggregate_id AND t.user_id = v_user;
  IF v_symbol IS NULL THEN
    RAISE EXCEPTION 'record_universe_rerank: event % names no tranche of the owner''s', p_event_id;
  END IF;

  -- Exclude, never shortening a window already in force.
  UPDATE public.investment_universe
     SET excluded_until  = GREATEST(COALESCE(excluded_until, '-infinity'::timestamptz), now() + make_interval(days => p_exclude_days)),
         excluded_reason = 'sold: TrancheClosed #' || p_event_id::text
   WHERE user_id = v_user AND upper(trim(symbol)) = v_symbol
   RETURNING excluded_until INTO v_until;
  v_in := FOUND;

  -- rank-v2: excluded last, then tier, then conviction desc (unscored last), then symbol.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'rank', r.rn, 'symbol', r.symbol, 'tier', r.tier,
           'conviction', r.overall_conviction, 'excluded', r.excluded) ORDER BY r.rn), '[]'::jsonb)
    INTO v_ranking
    FROM (
      SELECT u.symbol, u.tier, u.overall_conviction,
             (u.excluded_until IS NOT NULL AND u.excluded_until > now()) AS excluded,
             row_number() OVER (
               ORDER BY (u.excluded_until IS NOT NULL AND u.excluded_until > now()),
                        CASE u.tier WHEN 'top25' THEN 0 WHEN 'top100' THEN 1 WHEN 'bench' THEN 2 ELSE 3 END,
                        u.overall_conviction DESC NULLS LAST,
                        u.symbol
             ) AS rn
        FROM public.investment_universe u
       WHERE u.user_id = v_user
    ) r;

  INSERT INTO public.universe_reranks (user_id, event_id, symbol, in_universe, excluded_until, rank_version, ranking)
  VALUES (v_user, p_event_id, v_symbol, v_in, v_until, 'rank-v2', v_ranking)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'symbol', v_symbol, 'in_universe', v_in, 'excluded_until', v_until,
                            'rank_version', 'rank-v2', 'names', jsonb_array_length(v_ranking), 'repeated', false);
END $$;

REVOKE ALL ON FUNCTION public.record_universe_rerank(BIGINT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_universe_rerank(BIGINT, INT) TO authenticated;

COMMENT ON TABLE public.universe_reranks IS
  'BR-004: one record per TrancheClosed event — the sold symbol, whether it was in the universe, its exclusion, and the ranking (rank-v2) the database computed at that moment. Written only by record_universe_rerank(); client role reads its own rows.';
