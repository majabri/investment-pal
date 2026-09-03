-- The margin rate becomes IPS policy (ADR-APP-007).
--
-- It was a constant in two places: `(marginUsed * 0.11825) / 365` on the
-- dashboard and the string "Owed to Fidelity at 11.825% APR" on MarginCard.
-- They agreed by coincidence; nothing kept them agreeing, so changing one
-- would have left the app confidently displaying a rate it was not using.
--
-- `ips.schema.json` in the certified repository defines `margin_policy` as a
-- first-class IPS object, so the rate belongs here rather than in app config.
--
-- CRITICAL: NO DEFAULT FOR THE RATE, AND NO BACKFILL. NULL means not set, and
-- the UI suppresses the cost figure entirely rather than computing with a
-- fallback. A missing rate that silently computes as zero makes leverage look
-- free, which is the exact failure this migration exists to prevent. The old
-- 11.825 must never appear here as a default: it is stale, and Amir enters the
-- current value through Settings.
ALTER TABLE public.ips_lite
  ADD COLUMN IF NOT EXISTS margin_rate_annual_pct  NUMERIC,
  ADD COLUMN IF NOT EXISTS margin_rate_as_of       DATE,
  ADD COLUMN IF NOT EXISTS margin_rate_is_floating BOOLEAN NOT NULL DEFAULT true,
  -- Display threshold only, not a money calculation: how old the as-of date may
  -- get before the supervision strip flags it.
  ADD COLUMN IF NOT EXISTS margin_rate_stale_days  INTEGER NOT NULL DEFAULT 30;

COMMENT ON COLUMN public.ips_lite.margin_rate_annual_pct IS
  'Annual margin rate as a percentage (e.g. 11.825), NOT a fraction. NULL = not set; never default, never backfill. Unset suppresses the cost figure rather than computing zero.';
COMMENT ON COLUMN public.ips_lite.margin_rate_as_of IS
  'Date the rate was verified against the broker. NULL = never verified.';
COMMENT ON COLUMN public.ips_lite.margin_rate_is_floating IS
  'True when the rate floats with the broker base rate. Fidelity tiers by debit balance and floats, so true is the honest default.';
COMMENT ON COLUMN public.ips_lite.margin_rate_stale_days IS
  'Flag the rate as stale after this many days. Display threshold, changeable in Settings.';

-- Bounds only — this does not supply a value. A negative or absurd rate is a
-- data error; NULL remains entirely valid and is the shipped state.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ips_lite_margin_rate_bounds') THEN
    ALTER TABLE public.ips_lite
      ADD CONSTRAINT ips_lite_margin_rate_bounds
      CHECK (
        (margin_rate_annual_pct IS NULL OR (margin_rate_annual_pct >= 0 AND margin_rate_annual_pct <= 100))
        AND margin_rate_stale_days > 0
      );
  END IF;
END $$;
