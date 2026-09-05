-- Defaults must be labelled as defaults (Phase 4, rule 15), and policy classes
-- are not interchangeable (rule 21).
--
-- `ips_lite` declares:
--
--   position_cap_pct  NUMERIC NOT NULL DEFAULT 30,
--   margin_cap_pct    NUMERIC NOT NULL DEFAULT 25,
--   position_cap_hard BOOLEAN NOT NULL DEFAULT false,
--
-- Those three are ADR-APP-004's signed-off defaults, and they are legitimate as
-- defaults. What is not legitimate is that NOTHING CAN TELL THEM APART FROM A
-- CHOICE. The Settings form pre-fills 30 and 25, the dashboard says
-- "> 30% cap", and the committee prompt states the caps to a model as the
-- user's own investment policy — in every case whether or not a person ever
-- opened the form. Rule 15: "Defaults must be labelled as defaults and must
-- never masquerade as user preferences."
--
-- This is the same shape as `accounts.account_type_source` in Phase 1b, and it
-- takes the same fix: record WHERE the value came from, once, and never infer
-- it again at runtime.
--
--   'user_set'       — a person saved the policy form. Their choice.
--   'legacy_unknown' — the row predates this column. The values may be the
--                      user's or may be the column defaults nobody chose;
--                      the app cannot tell, and says so rather than guessing.
--
-- No row at all is a third state and needs no column: the app falls back to the
-- signed-off defaults and labels them as defaults.
--
-- The VALUES are not changed. This migration adds a column and backfills its
-- provenance; every cap keeps the number it had.
--
-- Money-adjacent under OD-001 (thresholds). No threshold is created, removed or
-- altered here — only labelled. Merged under the master brief's standing
-- instruction to self-merge on a green gate, called out rather than merged
-- silently.
ALTER TABLE public.ips_lite
  ADD COLUMN IF NOT EXISTS caps_source TEXT;

-- Every row that exists before this migration. `IS NULL` rather than a blanket
-- UPDATE so re-running it cannot relabel a row a person has since confirmed.
UPDATE public.ips_lite SET caps_source = 'legacy_unknown' WHERE caps_source IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ips_lite_caps_source_known') THEN
    ALTER TABLE public.ips_lite
      ADD CONSTRAINT ips_lite_caps_source_known
      CHECK (caps_source IS NULL OR caps_source IN ('user_set', 'legacy_unknown'));
  END IF;
END $$;

COMMENT ON COLUMN public.ips_lite.caps_source IS
  'Where position_cap_pct / position_cap_hard / margin_cap_pct came from: user_set = a person saved the form; legacy_unknown = the row predates this column and the values may be the ADR-APP-004 defaults nobody chose. NULL is treated as legacy_unknown. Never inferred at runtime (rule 15).';
COMMENT ON COLUMN public.ips_lite.position_cap_pct IS
  'Max single position as % of gross. A USER RISK POLICY (rule 21) — not a system safety rule and not a regulatory limit. Its default is ADR-APP-004''s; caps_source says whether this row is a choice.';
COMMENT ON COLUMN public.ips_lite.margin_cap_pct IS
  'Max margin utilisation as % of the account. A USER RISK POLICY (rule 21). Reg-T and the broker''s own house requirement are separate constraints the app does not store and must never conflate with this.';
