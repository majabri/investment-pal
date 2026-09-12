-- The execution ledger: fills, tranches, and a decision's own account (§12, §13.1).
--
-- `orders` covers most of §12.2 and `position_lots` covers tax lots, but three
-- things the blueprint requires have nowhere to live, and each absence shows up
-- as a wrong answer rather than a missing feature:
--
--   1. FILLS (§12.3). A partial fill is collapsed into two columns on the order
--      — `filled_quantity` and `average_fill_price`. Fees vanish, the broker's
--      confirmation reference vanishes, and a second partial OVERWRITES the
--      first rather than adding to it. §26.2 lists "partial fill updates
--      exactly once" as a mandatory data-state test and it cannot be written
--      against a schema that cannot represent two fills.
--
--   2. TRANCHES (§12.4, BR-010). The blueprint's worked example: a 50-share
--      core holding plus a new 10-share tactical trade displays as 60 aggregate
--      shares, but the 10-share tranche must stay separately identifiable for
--      lifecycle, attribution and exit logic. `position_lots` is tax lots —
--      cost basis and holding period — which is a different question from
--      "which decision opened this, and when does it close". Without tranches,
--      exiting "the tactical piece" is a share count somebody works out by hand.
--
--   3. A DECISION'S ACCOUNT AND ITS SUPERSESSOR (§13.1, Appendix B.1, DEC-005).
--      `decisions` has `symbol` but no `account_id`, so a recommendation cannot
--      say which account it is about — in a household of six. And it has no
--      `supersedes_decision_id`, so "superseded recommendations remain
--      immutable and link to their replacement" cannot be satisfied: today the
--      only way to change a recommendation is to lose the old one.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--
-- It does not backfill. Every existing decision keeps a NULL `account_id`,
-- which is the honest state: nobody recorded which account those were about,
-- and guessing from the household's primary account would put a fabricated
-- answer in a table the app treats as memory. NULL reads as NOT KNOWN
-- everywhere, which is exactly right here.
--
-- It does not migrate `orders.filled_quantity` into `fills`. That column keeps
-- working and stays authoritative until a screen writes fills; deriving
-- synthetic fill rows from a rolled-up total would invent timestamps, prices
-- and fees that nobody recorded.

-- ---------------------------------------------------------------------------
-- fills (§12.3)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fills (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,

  -- A fill without its order is unattributable. CASCADE because a deleted
  -- order's fills describe nothing.
  order_id      UUID NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,

  -- WHEN it filled, as an instant. Unlike a cash flow — which settles on a day
  -- — a fill happens at a moment, and two partials on one order are ordered by
  -- it. Timestamped, not dated, because the ordering is the point.
  filled_at     TIMESTAMPTZ NOT NULL,

  -- Always positive. The SIDE lives on the order; a signed quantity here would
  -- be a second, disagreeing source for the direction.
  quantity      NUMERIC NOT NULL,
  price         NUMERIC NOT NULL,

  -- Commissions and fees for THIS fill, positive as a cost. NULL is NOT KNOWN
  -- — an import that does not carry fees must not report zero, because a zero
  -- fee is a claim that the trade was free.
  fees          NUMERIC,

  -- Where the row came from. No AI value (rule 18).
  source        TEXT NOT NULL,

  -- The broker's own confirmation reference (§12.3). This is what makes a fill
  -- reconcilable against a statement, and what makes a re-import idempotent.
  broker_ref    TEXT,

  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fills_bounds') THEN
    ALTER TABLE public.fills
      ADD CONSTRAINT fills_bounds
      CHECK (
        source IN ('imported', 'user_entry', 'derived')
        -- A zero-quantity fill is not a fill, and a negative one is a side
        -- error: the direction belongs to the order.
        AND quantity > 0
        -- Nothing fills at exactly nothing. A zero price is a missing price,
        -- and the same rule the valuation coverage work applies to holdings.
        AND price > 0
        -- Fees are a cost or nothing. A negative fee is a rebate, which is a
        -- real thing but is not a fee — it belongs in `cash_flows`.
        AND (fees IS NULL OR fees >= 0)
        AND (broker_ref IS NULL OR btrim(broker_ref) <> '')
      );
  END IF;
END $$;

-- Idempotency (§19.3, §26.2 "repeated import is idempotent").
--
-- A broker reference identifies one fill at one broker. Re-importing the same
-- statement must not double a position, so the same reference cannot land
-- twice for one user. Partial — a fill with no reference (hand-entered) is not
-- constrained, because NULLs would otherwise collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS fills_broker_ref_unique
  ON public.fills (user_id, broker_ref)
  WHERE broker_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS fills_order_idx ON public.fills (order_id, filled_at);

-- ---------------------------------------------------------------------------
-- tranches (§12.4, BR-010)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tranches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  account_id    UUID NOT NULL REFERENCES public.accounts (id) ON DELETE CASCADE,

  -- The label, and the identity. `symbol` stays as the label the user reads;
  -- `security_id` is the identity that survives a rename (DATA-001). Nullable
  -- because the security master is populated separately and a tranche must not
  -- wait on it.
  symbol        TEXT NOT NULL,
  security_id   UUID REFERENCES public.securities (id) ON DELETE SET NULL,

  -- WHAT KIND of position this is. The blueprint's distinction: a core holding
  -- and a tactical trade in the same symbol aggregate for display and have
  -- separate lifecycles.
  kind          TEXT NOT NULL,

  -- Which decision opened it, so §A.3's chain from decision to execution to
  -- outcome is a foreign key rather than a reconstruction. SET NULL, because a
  -- deleted decision must not take the position with it.
  decision_id   UUID REFERENCES public.decisions (id) ON DELETE SET NULL,

  opened_at     TIMESTAMPTZ NOT NULL,
  -- NULL = still open. The whole point of separate identity is that this can
  -- close while the core holding continues.
  closed_at     TIMESTAMPTZ,

  -- Size as opened. What REMAINS is derived from the fills against it, never
  -- stored — a stored remainder is a second source of truth that drifts.
  opened_quantity NUMERIC NOT NULL,

  -- The plan this tranche was opened under, in the holder's words.
  target        NUMERIC,
  invalidation  TEXT,
  note          TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tranches_bounds') THEN
    ALTER TABLE public.tranches
      ADD CONSTRAINT tranches_bounds
      CHECK (
        btrim(symbol) <> ''
        AND kind IN ('core', 'tactical')
        AND opened_quantity > 0
        AND (target IS NULL OR target > 0)
        -- A tranche cannot close before it opened. A reversed pair is an
        -- import error, and it would make every holding-period figure negative.
        AND (closed_at IS NULL OR closed_at >= opened_at)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tranches_account_idx ON public.tranches (account_id, symbol);
CREATE INDEX IF NOT EXISTS tranches_open_idx ON public.tranches (account_id) WHERE closed_at IS NULL;

-- ---------------------------------------------------------------------------
-- decisions: its account, and its supersessor (§13.1, DEC-005)
-- ---------------------------------------------------------------------------

ALTER TABLE public.decisions
  -- NOT backfilled. NULL is "nobody recorded which account this was about",
  -- which is true of every existing row and is different from any account.
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts (id) ON DELETE SET NULL;

ALTER TABLE public.decisions
  -- DEC-005: a superseded recommendation stays immutable and links to its
  -- replacement. The link points from the NEW decision back to the one it
  -- replaces, so the old row is never touched — which is what "remains
  -- immutable" means.
  ADD COLUMN IF NOT EXISTS supersedes_decision_id UUID
    REFERENCES public.decisions (id) ON DELETE SET NULL;

-- One replacement per decision. Two decisions both claiming to supersede the
-- same one is a fork, and a reader cannot tell which is current.
CREATE UNIQUE INDEX IF NOT EXISTS decisions_supersedes_unique
  ON public.decisions (supersedes_decision_id)
  WHERE supersedes_decision_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS decisions_account_idx ON public.decisions (account_id, decided_on);

-- A decision cannot supersede itself. A self-link is a cycle of length one and
-- every "what replaced this?" walk would never terminate.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'decisions_no_self_supersede') THEN
    ALTER TABLE public.decisions
      ADD CONSTRAINT decisions_no_self_supersede
      CHECK (supersedes_decision_id IS NULL OR supersedes_decision_id <> id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.fills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tranches ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'fills' AND policyname = 'own fills') THEN
    CREATE POLICY "own fills" ON public.fills
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tranches' AND policyname = 'own tranches') THEN
    CREATE POLICY "own tranches" ON public.tranches
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- `updated_at` on tranches only. Fills are append-only in practice — a fill
-- that happened does not change — but they are NOT given an immutability
-- trigger here: a mis-entered fill needs correcting, and unlike a goal version
-- nothing cites a fill as the context a past decision was taken under.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tranches_updated') THEN
    CREATE TRIGGER trg_tranches_updated
      BEFORE UPDATE ON public.tranches
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE public.fills IS
  'One execution against an order (§12.3). Two partials are two rows; orders.filled_quantity rolls them up and cannot represent them separately.';
COMMENT ON COLUMN public.fills.fees IS
  'Positive as a cost. NULL is NOT KNOWN — an import without fees must not report zero, because a zero fee claims the trade was free.';
COMMENT ON TABLE public.tranches IS
  'A position with its own lifecycle (§12.4, BR-010). A core holding and a tactical trade in one symbol aggregate for display and close separately.';
COMMENT ON COLUMN public.decisions.supersedes_decision_id IS
  'DEC-005. Points from the NEW decision to the one it replaces, so the superseded row is never modified.';
COMMENT ON COLUMN public.decisions.account_id IS
  'Which account the recommendation is about (§13.1). NULL on every pre-existing row: nobody recorded it, and guessing would fabricate memory.';
