-- Strategy rules become data (Phase 4, rules 16 and 21).
--
-- `src/lib/data/familyPolicy.ts` still carries one household's STRATEGY as
-- constants: an approved universe in four buckets (28 tickers), a 5%
-- speculative cap, a parity rule written as a sentence, and a set of scoring
-- weights. Three problems, in ascending order of seriousness:
--
--   * Rule 21. A strategy rule is not a user risk policy and not a system
--     safety rule, and these were indistinguishable from both — the approved
--     universe drove a "% in approved names" figure on /kids with nothing
--     saying whose approval it was.
--   * Rule 16. Strategies must sit ON TOP of the accounting layer and never
--     redefine it. A strategy compiled into `src/lib/data/` is not on top of
--     anything; it is part of the application.
--   * Rule 37. A second user of this app inherits somebody else's approved
--     universe, and the only way to change it is to change the source.
--
-- NO ROWS ARE PROVISIONED. A user with no strategy has no approved universe,
-- and the screens say so rather than showing 0% in approved names — which is a
-- verdict, and a false one, when there is no list to be inside of.
--
-- Not money-adjacent under OD-001: no threshold here sizes a position or moves
-- cash. `speculative_max_pct` is a strategy's own limit on itself, stored and
-- displayed; nothing computes a trade from it.
CREATE TABLE IF NOT EXISTS public.strategies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name                TEXT NOT NULL,

  -- NULL = no such rule. Deliberately free text: a parity rule is a sentence a
  -- person wrote for a committee to read, not a computed constraint, and
  -- pretending otherwise would be the "AI recommendation as a limit" confusion
  -- rule 21 separates out.
  parity_rule         TEXT,

  -- NULL = no cap stated, which is NOT a cap of 0%. A strategy may simply not
  -- limit speculative holdings.
  speculative_max_pct NUMERIC,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.strategy_symbols (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES public.strategies (id) ON DELETE CASCADE,
  symbol      TEXT NOT NULL,
  -- Required. A symbol with no bucket cannot be shown, capped or reasoned
  -- about — there is no honest default bucket, and "core" would be the worst
  -- possible guess.
  bucket      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'strategies_bounds') THEN
    ALTER TABLE public.strategies
      ADD CONSTRAINT strategies_bounds
      CHECK (
        btrim(name) <> ''
        AND (speculative_max_pct IS NULL
             OR (speculative_max_pct >= 0 AND speculative_max_pct <= 100))
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'strategy_symbols_bounds') THEN
    ALTER TABLE public.strategy_symbols
      ADD CONSTRAINT strategy_symbols_bounds
      CHECK (
        btrim(symbol) <> ''
        AND bucket IN ('core', 'supporting', 'preferred_future', 'speculative')
      );
  END IF;
END $$;

-- One bucket per symbol per strategy. A symbol listed as both core and
-- speculative would make "% in approved names" depend on iteration order.
CREATE UNIQUE INDEX IF NOT EXISTS strategy_symbols_unique
  ON public.strategy_symbols (strategy_id, symbol);
CREATE INDEX IF NOT EXISTS strategy_symbols_strategy_idx
  ON public.strategy_symbols (strategy_id);
CREATE INDEX IF NOT EXISTS strategies_user_idx ON public.strategies (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategy_symbols TO authenticated;
GRANT ALL ON public.strategies TO service_role;
GRANT ALL ON public.strategy_symbols TO service_role;
ALTER TABLE public.strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy_symbols ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'strategies' AND policyname = 'own strategies'
  ) THEN
    CREATE POLICY "own strategies" ON public.strategies
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'strategy_symbols' AND policyname = 'own strategy symbols'
  ) THEN
    CREATE POLICY "own strategy symbols" ON public.strategy_symbols
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_strategies_updated') THEN
    CREATE TRIGGER trg_strategies_updated
      BEFORE UPDATE ON public.strategies
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE public.strategies IS
  'A strategy sits ON TOP of the accounting layer and never redefines it (rule 16). No rows are provisioned — a user with no strategy has no approved universe, and the screens say so.';
COMMENT ON COLUMN public.strategies.speculative_max_pct IS
  'NULL = no cap stated, which is not a cap of 0%. A STRATEGY RULE (rule 21) — not the user''s risk policy in ips_lite, and not a regulatory constraint.';
COMMENT ON COLUMN public.strategy_symbols.bucket IS
  'core | supporting | preferred_future | speculative. Required: there is no honest default bucket, and "core" would be the worst possible guess.';
