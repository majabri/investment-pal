-- Lots and tranches (Phase 6, rule 19).
--
-- "A position may hold several. Aggregate exposure AND individual tranche
-- identity must both survive. An exit attached to a new tranche must never
-- apply to the whole position."
--
-- `holdings` is one row per (user, account, symbol) with a single
-- `cost_basis`, so the app cannot currently represent a position built in
-- pieces. Three things are lost by that, in ascending order of seriousness:
--
--   * Tax lots. Selling "the position" and selling the November lot are
--     different transactions with different tax consequences, and the app
--     cannot say which happened.
--   * Blended cost basis hides a losing tranche inside a winning position.
--   * A STOP. If a stop is entered against a tranche bought this week and the
--     app only knows about "the position", the stop reads as covering the
--     whole holding — which is either far too much size at risk or, if the
--     user believed otherwise, a position left unprotected.
--
-- The third is the one rule 19 calls out, and it is a money-losing failure in
-- both directions.
--
-- `holdings` STAYS. It is the aggregate, it is what every screen reads, and
-- replacing it would be a rewrite rather than a capability. Lots sit beneath
-- it: a position with no lots recorded is a position whose composition is not
-- known, which is different from a position with one lot.
--
-- Money-adjacent under OD-001: tax lots are named explicitly in the rule. No
-- arithmetic here changes any existing figure — this migration adds a table
-- nothing reads yet. Merged under the master brief's standing instruction to
-- self-merge on a green gate, called out rather than merged silently.
CREATE TABLE IF NOT EXISTS public.position_lots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  -- Required, and the reason a lot cannot drift between accounts. Rule 29's
  -- "an import to one account must not touch another" starts here.
  account_id     UUID NOT NULL REFERENCES public.accounts (id) ON DELETE CASCADE,
  symbol         TEXT NOT NULL,

  -- The broker's own lot identifier where it has one. Used for idempotent
  -- re-import, and NULL for a hand-entered lot.
  broker_lot_id  TEXT,

  -- Size and cost of THIS lot. Nullable because an import may carry a lot it
  -- cannot fully read, and a lot with an unknown size must still be visible —
  -- an invisible lot is a silently smaller position.
  quantity       NUMERIC,
  cost_per_share NUMERIC,

  -- When it was acquired. Drives holding-period and therefore tax treatment,
  -- so NULL means the treatment is NOT KNOWN rather than short-term.
  acquired_at    DATE,

  -- What the lot is for, in the holder's terms. Free text, and separate from
  -- the holding's thesis: a tranche added on a thesis change has its own
  -- reason, and rule 29 requires theses to survive a position refresh.
  thesis         TEXT,
  notes          TEXT,

  -- Where this row came from. No AI value (rule 18).
  source         TEXT NOT NULL,
  -- When the figures were TRUE, not when the row was written (Phase 1d).
  as_of          TIMESTAMPTZ,

  -- Whether the lot is still held. Closing is a state change rather than a
  -- delete, so history and the decisions attached to it survive (rule 29).
  closed_at      TIMESTAMPTZ,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'position_lots_bounds') THEN
    ALTER TABLE public.position_lots
      ADD CONSTRAINT position_lots_bounds
      CHECK (
        btrim(symbol) <> ''
        AND (quantity IS NULL OR quantity > 0)
        AND (cost_per_share IS NULL OR cost_per_share >= 0)
        AND source IN ('imported', 'user_entry')
      );
  END IF;
END $$;

-- An exit attached to a tranche. This is the column that stops a stop entered
-- against one lot from reading as covering the whole position (rule 19).
--
-- On `orders`, not on the lot, because one order may protect several lots and
-- a lot may be protected by none.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES public.position_lots (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS position_lots_account_symbol_idx
  ON public.position_lots (account_id, symbol);
CREATE INDEX IF NOT EXISTS position_lots_user_idx ON public.position_lots (user_id);
CREATE INDEX IF NOT EXISTS orders_lot_idx ON public.orders (lot_id);

-- Idempotent re-import, partial so several hand-entered lots can coexist.
CREATE UNIQUE INDEX IF NOT EXISTS position_lots_broker_id_unique
  ON public.position_lots (account_id, broker_lot_id)
  WHERE broker_lot_id IS NOT NULL;

-- Whether the app has been told this account's LOT composition, distinct from
-- whether it has positions at all. NULL — every existing row — means nobody
-- has said, and a position with no lots is then a position of unknown
-- composition rather than a position of one lot (rule 13).
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS lots_as_of TIMESTAMPTZ;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.position_lots TO authenticated;
GRANT ALL ON public.position_lots TO service_role;
ALTER TABLE public.position_lots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'position_lots' AND policyname = 'own position lots'
  ) THEN
    CREATE POLICY "own position lots" ON public.position_lots
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_position_lots_updated') THEN
    CREATE TRIGGER trg_position_lots_updated
      BEFORE UPDATE ON public.position_lots
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE public.position_lots IS
  'Tranches beneath a holding (rule 19). `holdings` remains the aggregate; lots record how it was built. No rows for any existing account — a position with no lots is one whose composition is NOT KNOWN, not one of a single lot.';
COMMENT ON COLUMN public.position_lots.acquired_at IS
  'Drives holding period and therefore tax treatment. NULL = the treatment is NOT KNOWN, never short-term by default.';
COMMENT ON COLUMN public.position_lots.closed_at IS
  'Closing is a state change, not a delete, so the lot''s history and the decisions attached to it survive a position refresh (rule 29).';
COMMENT ON COLUMN public.orders.lot_id IS
  'The tranche this order is attached to. NULL = the whole position. This is what stops a stop entered against one lot from reading as covering the entire holding (rule 19).';
COMMENT ON COLUMN public.accounts.lots_as_of IS
  'When the app was last told this account''s LOT composition. NULL = never; a position with no lots is then of unknown composition.';
