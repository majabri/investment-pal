-- A canonical security master, so a ticker stops being an identity (UNIV-001 / DATA-001).
--
-- Every table that names an instrument is keyed on the TICKER:
--
--   holdings              UNIQUE (user_id, account_id, symbol)
--   investment_universe   UNIQUE (user_id, symbol)
--   price_history         UNIQUE (user_id, symbol, date)
--   strategy_symbols      UNIQUE (strategy_id, symbol)
--   watchlist             UNIQUE (user_id, symbol)
--
-- A ticker is a LABEL. It is reassigned, renamed and reused:
--
--   * FB became META in 2022. Same company, and today the app holds two
--     unrelated rows with two unrelated price histories.
--   * A delisted shell's ticker is handed to a new issuer, and the old
--     position's history silently continues under the new company's prices.
--   * The broker exports a CUSIP for a fund and a ticker for the same fund in
--     a different report, and the app holds the position twice.
--   * Class shares (BRK.A / BRK.B) and the same issuer on two venues are
--     different instruments that a naive symbol match may or may not separate.
--
-- The fix is an identity that does not move — `securities.id` — and a table of
-- the labels that have pointed at it over time.
--
-- WHY ALIASES ARE DATED
--
-- `valid_from` / `valid_to` are what make FB → META a RENAME rather than two
-- companies. A price recorded under FB in 2019 belongs to the same security as
-- one recorded under META in 2026, and the alias window is what says so. A
-- ticker recycled to a different issuer gets a CLOSED window on the old
-- security and an open one on the new, so history never crosses.
--
-- ONE CANONICAL SECTOR
--
-- `securities.sector` is the single classification (UNIV-001). Today there are
-- two — `holdings.sector` and the built-in map in `src/lib/data/sectors.ts` —
-- and a third source added without an explicit precedence would simply be a
-- third classification. `sector_source` records WHICH answer won, so a
-- classification can be audited rather than guessed at; the resolution order
-- lives in `src/lib/securityMaster.ts` with its tests.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
-- It does not re-key anything. `security_id` is added NULLABLE to the tables
-- above, and NULL means NOT YET RESOLVED — not "no security" (rule 13).
-- Re-keying is a data migration with a backfill and its own sign-off; doing it
-- in the same step as introducing the identity would mean rewriting every
-- holding on a schema nothing has exercised yet.
--
-- Money-adjacent under OD-001 only in that a mis-resolved alias would attach
-- one instrument's prices to another's position. That is precisely why alias
-- resolution refuses an ambiguous match instead of picking the newest, and why
-- nothing is re-keyed here. No arithmetic changes; no existing figure moves.
CREATE TABLE IF NOT EXISTS public.securities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,

  -- The label to SHOW. Not the identity — that is `id`, and it never changes.
  canonical_symbol TEXT NOT NULL,
  name             TEXT,

  -- What kind of instrument. Drives which arithmetic is even meaningful: a
  -- cash-equivalent has no sector and crypto has no earnings date.
  asset_class      TEXT NOT NULL,

  -- THE sector (UNIV-001). One column, one answer.
  sector           TEXT,
  -- Which source produced it, so a classification can be audited. NULL sector
  -- with a NULL source means NOT CLASSIFIED, which is not the same as a
  -- security classified as "Unclassified" by a human who looked.
  sector_source    TEXT,

  -- Stable external identifiers, where the broker or a free source supplies
  -- one. These outlive tickers and are how two labels are proved to be one
  -- instrument rather than assumed to be.
  figi             TEXT,
  cusip            TEXT,
  isin             TEXT,

  -- Delisting is a state change, not a delete: the position, its history and
  -- the decisions attached to it all survive (rule 29).
  delisted_at      DATE,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'securities_bounds') THEN
    ALTER TABLE public.securities
      ADD CONSTRAINT securities_bounds
      CHECK (
        btrim(canonical_symbol) <> ''
        AND asset_class IN ('equity', 'etf', 'fund', 'crypto', 'cash', 'other')
        AND (sector_source IS NULL OR sector_source IN ('user', 'builtin_map', 'provider'))
        -- A sector with no source cannot be audited, and a source with no
        -- sector is a provenance for nothing. They travel together.
        AND ((sector IS NULL) = (sector_source IS NULL))
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS securities_user_canonical_unique
  ON public.securities (user_id, canonical_symbol);

-- Every label that has ever pointed at a security, with the window it pointed
-- during. This is what makes FB → META a rename.
CREATE TABLE IF NOT EXISTS public.security_aliases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  security_id  UUID NOT NULL REFERENCES public.securities (id) ON DELETE CASCADE,

  alias        TEXT NOT NULL,
  alias_kind   TEXT NOT NULL,

  -- NULL `valid_from` = has always pointed here. NULL `valid_to` = still does.
  -- A closed window is how a recycled ticker stops resolving to the dead
  -- issuer without deleting the fact that it once did.
  valid_from   DATE,
  valid_to     DATE,

  source       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'security_aliases_bounds') THEN
    ALTER TABLE public.security_aliases
      ADD CONSTRAINT security_aliases_bounds
      CHECK (
        btrim(alias) <> ''
        AND alias_kind IN ('ticker', 'cusip', 'isin', 'figi', 'broker_label')
        AND source IN ('imported', 'user_entry', 'derived')
        AND (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from)
      );
  END IF;
END $$;

-- At most ONE open window per label. Two securities both currently claiming
-- "META" is the ambiguity that would attach one company's prices to another's
-- position, and it is refused at the database rather than resolved in code.
CREATE UNIQUE INDEX IF NOT EXISTS security_aliases_open_unique
  ON public.security_aliases (user_id, alias)
  WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS security_aliases_security_idx
  ON public.security_aliases (security_id);
CREATE INDEX IF NOT EXISTS security_aliases_lookup_idx
  ON public.security_aliases (user_id, alias);

-- The pointer, nullable everywhere. NULL = not yet resolved to a security,
-- which is a known unknown; the ticker columns stay exactly as they are and
-- remain what every screen reads until a backfill is signed off separately.
ALTER TABLE public.holdings
  ADD COLUMN IF NOT EXISTS security_id UUID REFERENCES public.securities (id) ON DELETE SET NULL;
ALTER TABLE public.investment_universe
  ADD COLUMN IF NOT EXISTS security_id UUID REFERENCES public.securities (id) ON DELETE SET NULL;
ALTER TABLE public.price_history
  ADD COLUMN IF NOT EXISTS security_id UUID REFERENCES public.securities (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS holdings_security_idx ON public.holdings (security_id);
CREATE INDEX IF NOT EXISTS investment_universe_security_idx
  ON public.investment_universe (security_id);
CREATE INDEX IF NOT EXISTS price_history_security_idx ON public.price_history (security_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.securities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.security_aliases TO authenticated;
GRANT ALL ON public.securities TO service_role;
GRANT ALL ON public.security_aliases TO service_role;
ALTER TABLE public.securities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_aliases ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'securities' AND policyname = 'own securities'
  ) THEN
    CREATE POLICY "own securities" ON public.securities
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'security_aliases' AND policyname = 'own security aliases'
  ) THEN
    CREATE POLICY "own security aliases" ON public.security_aliases
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_securities_updated') THEN
    CREATE TRIGGER trg_securities_updated
      BEFORE UPDATE ON public.securities
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE public.securities IS
  'Canonical instrument identity (UNIV-001/DATA-001). `id` is the identity and never moves; `canonical_symbol` is a label to display. Nothing is re-keyed by this migration — security_id is nullable everywhere and NULL means NOT YET RESOLVED.';
COMMENT ON TABLE public.security_aliases IS
  'Every label that has pointed at a security, with the window it pointed during. Dated windows are what make FB -> META a rename rather than two companies, and what stop a recycled ticker from inheriting a dead issuer''s price history.';
COMMENT ON COLUMN public.securities.sector IS
  'THE canonical sector (UNIV-001). `holdings.sector` and src/lib/data/sectors.ts were two classifications; this is the one, and sector_source records which produced it.';
COMMENT ON COLUMN public.securities.sector_source IS
  'Which source produced `sector`: ''user'' beats ''provider'' beats ''builtin_map''. NULL with a NULL sector means NOT CLASSIFIED, which differs from a human classifying something as Unclassified.';
