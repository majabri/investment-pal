-- Durable per-user request limits for provider-backed server functions.
-- This protects third-party quotas and AI spend across server instances; in-memory
-- caches alone do not provide that guarantee. Limits are intentionally enforced
-- inside the database function, not supplied by callers.

CREATE TABLE IF NOT EXISTS public.server_request_limits (
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('chat', 'market', 'calendar', 'news')),
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (user_id, scope, window_started_at)
);

ALTER TABLE public.server_request_limits ENABLE ROW LEVEL SECURITY;

-- The table is an internal implementation detail. Authenticated users may only
-- consume a fixed server-defined allowance through the function below.
REVOKE ALL ON TABLE public.server_request_limits FROM anon, authenticated;
GRANT ALL ON TABLE public.server_request_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_provider_request_limit(p_scope TEXT)
RETURNS TABLE (allowed BOOLEAN, remaining INTEGER, retry_after_seconds INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_limit INTEGER;
  v_window_seconds INTEGER;
  v_window_started_at TIMESTAMPTZ;
  v_request_count INTEGER;
  v_retry_after_seconds INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  CASE p_scope
    WHEN 'chat' THEN v_limit := 10; v_window_seconds := 600; -- 10 per 10 minutes
    WHEN 'market' THEN v_limit := 120; v_window_seconds := 60; -- 120 per minute
    WHEN 'calendar' THEN v_limit := 30; v_window_seconds := 600; -- 30 per 10 minutes
    WHEN 'news' THEN v_limit := 30; v_window_seconds := 600; -- 30 per 10 minutes
    ELSE RAISE EXCEPTION 'Unsupported rate-limit scope';
  END CASE;

  v_window_started_at := to_timestamp(
    floor(extract(epoch FROM clock_timestamp()) / v_window_seconds) * v_window_seconds
  );
  v_retry_after_seconds := GREATEST(
    1,
    ceil(extract(epoch FROM v_window_started_at + make_interval(secs => v_window_seconds) - clock_timestamp()))::INTEGER
  );

  -- Keep the bounded per-user ledger small without a separate scheduled job.
  DELETE FROM public.server_request_limits
  WHERE user_id = v_user_id
    AND window_started_at < clock_timestamp() - INTERVAL '1 day';

  INSERT INTO public.server_request_limits (user_id, scope, window_started_at, request_count)
  VALUES (v_user_id, p_scope, v_window_started_at, 1)
  ON CONFLICT (user_id, scope, window_started_at)
  DO UPDATE SET request_count = public.server_request_limits.request_count + 1
  WHERE public.server_request_limits.request_count < v_limit
  RETURNING request_count INTO v_request_count;

  IF FOUND THEN
    RETURN QUERY SELECT TRUE, v_limit - v_request_count, v_retry_after_seconds;
    RETURN;
  END IF;

  RETURN QUERY SELECT FALSE, 0, v_retry_after_seconds;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_provider_request_limit(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_provider_request_limit(TEXT) TO authenticated;
