-- IPS-lite: single-user policy record (ADR-APP-004). One row per user.
-- Defaults encode the signed-off numbers: 30% soft position cap, 25% margin cap.
-- Injected into every committee prompt and surfaced in the Constitution Check strip.
CREATE TABLE IF NOT EXISTS public.ips_lite (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users ON DELETE CASCADE,
  position_cap_pct  NUMERIC NOT NULL DEFAULT 30,    -- C2: max single-position % of gross
  position_cap_hard BOOLEAN NOT NULL DEFAULT false, -- C2: soft (flag only) vs hard
  margin_cap_pct    NUMERIC NOT NULL DEFAULT 25,    -- C3: max margin utilization % of account value
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ips_lite ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ips_lite_own_rows" ON public.ips_lite
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ips_lite TO authenticated;

-- Sanity bounds (0–100%); existing rows validate trivially.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ips_lite_pct_bounds') THEN
    ALTER TABLE public.ips_lite
      ADD CONSTRAINT ips_lite_pct_bounds
      CHECK (position_cap_pct >= 0 AND position_cap_pct <= 100
             AND margin_cap_pct >= 0 AND margin_cap_pct <= 100);
  END IF;
END $$;
