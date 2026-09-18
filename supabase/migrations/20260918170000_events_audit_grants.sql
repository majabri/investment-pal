-- Narrow the client roles' privileges on the event record and the audit log
-- to what 20260917150000 intended (§19.2, §24 SYS-004).
--
-- WHAT THE CATALOG SHOWED (2026-09-18, production, via Lovable):
--
--   domain_events  table   {postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm,
--                           service_role=arwdDxtm, sandbox_exec=ar}
--   domain_events  column  consumed_at {authenticated=w}
--
-- Supabase grants ALL on every new table in `public` to anon, authenticated
-- and service_role by default privileges. The events migration then wrote
-- `GRANT SELECT, UPDATE (consumed_at) ON domain_events TO authenticated` and
-- `GRANT SELECT ON audit_log TO authenticated`, believing those were the
-- roles' only privileges. They were additions to ALL, and narrowed nothing.
--
-- What protected the rows in the meantime was ROW LEVEL SECURITY, and it
-- still does: a user sees and consumes only their own events, and nobody
-- inserts into either table from the client (no policy admits it). Two
-- things RLS does not cover, and this migration closes:
--
--   * A user could UPDATE any column of their OWN events — event_type,
--     payload, aggregate_id — not just consumed_at. The outbox is meant to
--     be written by the trigger and consumed by the client, never edited.
--   * TRUNCATE is not subject to RLS at all. It is not reachable through
--     PostgREST, so the exposure was theoretical; it should not exist.
--
-- REVOKE, then re-grant exactly the intended surface. Both statements are
-- idempotent. `record_change()` is SECURITY DEFINER owned by postgres and is
-- untouched; service_role keeps ALL; `sandbox_exec` (Lovable's read role) is
-- not named here and keeps what it has.
--
-- The schema test asserts the resulting privileges with has_table_privilege /
-- has_column_privilege under the replay's model of Supabase's defaults.

REVOKE ALL ON TABLE public.domain_events FROM anon, authenticated;
GRANT SELECT ON TABLE public.domain_events TO authenticated;
GRANT UPDATE (consumed_at) ON TABLE public.domain_events TO authenticated;

REVOKE ALL ON TABLE public.audit_log FROM anon, authenticated;
GRANT SELECT ON TABLE public.audit_log TO authenticated;

COMMENT ON TABLE public.domain_events IS
  'The fourteen §19.1 domain events as durable outbox rows (§19.2). Raised by record_change() from the write that caused them; consumed_at is NULL until a consumer handles one. Client role: SELECT own rows, UPDATE consumed_at only (grants narrowed 20260918170000). No consumer exists yet — the record is kept so one can replay.';
