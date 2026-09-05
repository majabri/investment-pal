-- A broker-neutral order model (Phase 6, rule 19).
--
-- The app has never had one. That is not a missing feature, it is a hole in
-- the truth gate: `readiness.ts` hardcodes `openOrdersKnown: false` for every
-- caller, because there is no data that could make it true, and rule 30
-- requires the app to say "open-order status unavailable" rather than let a
-- recommendation assume nothing is committed. A buy recommendation made
-- without knowing what is already working can double a position by accident.
--
-- Two decisions worth stating before the columns:
--
-- 1. STATUSES ARE GENERIC. Not Fidelity's vocabulary, not any broker's. Rule
--    19 asks for this explicitly, and rule 8's "never infer accounting from a
--    label" is the reason: a broker's own status string is a label, and
--    mapping it belongs in the adapter (Phase 2), not in a screen.
--
-- 2. AN EMPTY `orders` TABLE IS NOT "NO OPEN ORDERS". `accounts.orders_as_of`
--    records when the app was last TOLD about this account's orders. NULL —
--    the shipped state for every row — means nobody has ever said, which is
--    exactly the distinction rule 13 keeps drawing and the one the readiness
--    gate needs to stop reporting `false` unconditionally.
--
-- Live broker execution remains permanently out of scope (ADR-APP-001). This
-- stores what the user or an import TELLS the app about orders; it places
-- none, and nothing here can.
--
-- Money-adjacent under OD-001 in the sense that these figures describe
-- committed capital. No arithmetic is added: the table stores, and the
-- readiness gate reads a boolean off it. Merged under the master brief's
-- standing instruction to self-merge on a green gate, called out rather than
-- merged silently.
CREATE TABLE IF NOT EXISTS public.orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  -- Required. An order belongs to exactly one account; rule 29's "an import to
  -- one account must not touch another" starts with the order knowing whose it
  -- is, and an accountless order could not be scoped out of any total.
  account_id         UUID NOT NULL REFERENCES public.accounts (id) ON DELETE CASCADE,

  -- The broker's own identifier. NULL for a hand-entered order. Used for
  -- idempotent re-import: the same broker order arriving twice updates rather
  -- than duplicating (rule 29).
  broker_order_id    TEXT,

  symbol             TEXT NOT NULL,
  side               TEXT NOT NULL,
  -- NULL = not known. A partially-read import must not claim a size.
  quantity           NUMERIC,
  order_type         TEXT NOT NULL,
  -- NULL = not applicable (a market order) OR not known. The order type says
  -- which, so a separate flag would be a second thing to keep consistent.
  limit_price        NUMERIC,
  stop_price         NUMERIC,
  time_in_force      TEXT,

  status             TEXT NOT NULL,
  -- NULL = not known. NOT zero: "nothing has filled" and "we were not told how
  -- much filled" are different, and the second must not read as the first.
  filled_quantity    NUMERIC,
  average_fill_price NUMERIC,

  -- Bracket and OCO structure. A stop attached to one leg must not be read as
  -- applying to the whole position — the tranche half of rule 19.
  parent_order_id    UUID REFERENCES public.orders (id) ON DELETE SET NULL,
  oco_group          TEXT,

  -- When the order was placed, and when the app last had news of it. Both
  -- nullable: an imported order may carry neither.
  placed_at          TIMESTAMPTZ,
  status_as_of       TIMESTAMPTZ,

  -- Where this row came from. Deliberately NOT nullable and deliberately
  -- excluding any AI value: rule 18 says a model may never be the source of an
  -- open order, and the CHECK below is that rule at the column.
  execution_source   TEXT NOT NULL,

  -- ISO 4217. NULL = not known; there is no USD default (rule 32).
  currency           TEXT,
  notes              TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_vocabulary') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_vocabulary
      CHECK (
        btrim(symbol) <> ''
        AND side IN ('buy', 'sell', 'sell_short', 'buy_to_cover')
        AND order_type IN ('market', 'limit', 'stop', 'stop_limit', 'trailing_stop', 'other')
        -- Generic, not one broker's. 'unknown' is a real status: an import may
        -- carry an order whose state the app cannot map, and dropping it would
        -- be worse than holding it as unknown.
        AND status IN (
          'pending_new', 'open', 'partially_filled', 'filled',
          'cancelled', 'rejected', 'expired', 'unknown'
        )
        AND (time_in_force IS NULL
             OR time_in_force IN ('day', 'gtc', 'ioc', 'fok', 'opg', 'cls', 'other'))
        -- Rule 18 at the column: a model may never be the source of an open
        -- order. There is no value here that means "the AI said so".
        AND execution_source IN ('imported', 'user_entry')
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_quantities_sane') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_quantities_sane
      CHECK (
        (quantity IS NULL OR quantity > 0)
        AND (filled_quantity IS NULL OR filled_quantity >= 0)
        AND (average_fill_price IS NULL OR average_fill_price >= 0)
        AND (limit_price IS NULL OR limit_price >= 0)
        AND (stop_price IS NULL OR stop_price >= 0)
        -- Deliberately NOT `filled_quantity <= quantity`: an over-fill is a
        -- data problem to surface, and a CHECK that rejects the row would
        -- discard the evidence instead of showing it.
      );
  END IF;

  -- An order cannot be its own parent. Deeper cycles are not checkable in a
  -- CHECK; the reader treats an unresolvable chain as a flat order.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_parent_not_self') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_parent_not_self CHECK (parent_order_id IS NULL OR parent_order_id <> id);
  END IF;
END $$;

-- Idempotent re-import: the same broker order arriving twice updates rather
-- than duplicating. Partial, because a hand-entered order has no broker id and
-- several of those must be able to coexist (rule 29).
CREATE UNIQUE INDEX IF NOT EXISTS orders_broker_id_unique
  ON public.orders (account_id, broker_order_id)
  WHERE broker_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_account_status_idx ON public.orders (account_id, status);
CREATE INDEX IF NOT EXISTS orders_user_idx ON public.orders (user_id);

-- WHEN the app was last told about this account's orders. NULL — the shipped
-- state for every existing row — means nobody has ever said, which is NOT the
-- same as "no open orders" (rule 30). This is the column the readiness gate
-- reads instead of its hardcoded `false`.
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS orders_as_of TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS orders_source TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_orders_source_known') THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT accounts_orders_source_known
      CHECK (orders_source IS NULL OR orders_source IN ('imported', 'user_entry'));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'orders' AND policyname = 'own orders'
  ) THEN
    CREATE POLICY "own orders" ON public.orders
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_orders_updated') THEN
    CREATE TRIGGER trg_orders_updated
      BEFORE UPDATE ON public.orders
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE public.orders IS
  'Broker-neutral order model (rule 19). Statuses are generic, never one broker''s vocabulary — mapping a broker''s own status belongs in its adapter. Live execution is permanently out of scope: this stores what the app is TOLD, it places nothing.';
COMMENT ON COLUMN public.orders.status IS
  'pending_new | open | partially_filled | filled | cancelled | rejected | expired | unknown. "unknown" is a real status: an import may carry an order whose state cannot be mapped, and dropping it would be worse than holding it.';
COMMENT ON COLUMN public.orders.filled_quantity IS
  'NULL = not known, which is NOT zero. "Nothing has filled" and "we were not told how much filled" are different facts.';
COMMENT ON COLUMN public.orders.execution_source IS
  'imported | user_entry. There is deliberately no AI value: rule 18 forbids a model being the source of an open order.';
COMMENT ON COLUMN public.accounts.orders_as_of IS
  'When the app was last told about this account''s orders. NULL = never. An empty orders table for such an account is NOT "no open orders" (rule 30).';
