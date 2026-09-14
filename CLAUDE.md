# CLAUDE.md — investment-pal

Working notes for Claude Code (and humans) on this repo. This is the live app
(TanStack Start + React/TS + Supabase, deployed by Lovable from `main`, at
invespal.lovable.app). It is evolving with Investment OS capabilities at
single-user scale — see [`docs/adr/ADR-APP-001.md`](docs/adr/ADR-APP-001.md).

## Package manager & verification gate

**This repo is bun-managed.** `bun.lock` is the source of truth and is what
Lovable builds from. There is no `package-lock.json` (removed — it drifted from
`package.json`/`bun.lock` and broke `npm ci`; Dependabot tracks the bun ecosystem
via `.github/dependabot.yml`).

**Before every merge, verify:**

```bash
bun install --frozen-lockfile   # or: npm install   (fallback where bun is unavailable)
npx tsc --noEmit                 # must be clean
npm run test:typecheck           # tsc over the test tree — catches a test that imports the browser client
bun test                         # 0 fail; the count only goes up
npm run dev                      # boot check: GET /auth, /, /portfolio, /decisions all 200
```

In the cloud sandbox the dev server is `npx vite dev --host 127.0.0.1 --port 8080`,
and `sleep` only works inside a `for` loop.

**Every guard is paired with a fault injection** — break the code deliberately
(`sed` a condition, restore from a backup) and show the tests redden. A passing
suite that never exercised the defect is not evidence. Every assertion group
carries a negative control proving it is not vacuous. The counts go in the PR.

Do **not** run `npm ci` (no npm lockfile) and do **not** commit a generated
`package-lock.json`.

## Operating rules

- **GitHub `main` is the single source of truth.** Branch → PR → merge. Small PRs,
  one capability each.
- **Merge authority (Amir, 2026-08-30; narrowed 2026-09-10; gate removed
  2026-09-12).** Claude Code merges its own PRs once the verification gate is
  green, and may close superseded or duplicate PRs. On 2026-09-12 Amir merged
  #212 himself with *"I need you to merge or have copilot merge do not wait for
  me"* — the second time he had said it — and that stands: **green gate →
  merge, including money-adjacent work.** What survives: a PR that computes a
  figure still says in its body what figure, on what basis, and what it
  deliberately does not do; genuine uncertainty about money, data integrity or
  real accounts still stops and files an OD (that is about not knowing the
  answer, not about permission); and nothing outside the repo — migrations,
  live data — is a merge. **ADRs are never self-merged** regardless
  (ADR-APP-005 §2).
  `OD-001` on disk still describes the earlier sign-off gate: Amendment 2 has
  not been written, because the session classifier refuses to let Claude Code
  edit its own merge-authority document, and Amir has been asked to write it.
  Until he does, this bullet is the record.
- **Never rewrite pushed history** (no force-push / rebase / amend / squash of
  pushed commits) — Lovable syncs from the branch and would lose history
  (see `AGENTS.md`).
- **Never commit secrets.** Free-tier keys only, in untracked env.
- Every PR cites the requirement / ADR it serves.

## Governance (from ADR-APP-001 / the Investment OS reference library)

- **Money-adjacent logic** — margin math, position sizing, tax lots, cash/order
  math — requires the owner's **explicit line-item sign-off** before merge
  (OD-001). Storing/measuring is not computing a trade, and neither is
  protecting a stored figure from being lost: the line is what a change
  **produces** (OD-001 Amendment 1). Doubt about whether it computes a figure
  still stops it.
- **Evidence contract** is mandatory on material recommendations;
  **confidence ≠ probability** (separate fields, never conflated).
- **Simulation/what-if never mutates live tables.** No silent self-modification.
- **Live broker execution is permanently out of scope.** The app recommends;
  Amir trades at Fidelity.
- Data is **free sources only** (OD-002; Stooq / Yahoo) behind the provider layer.
- When uncertain about money, data integrity, or real accounts: **stop**, file
  `docs/open-decisions/OD-xxx.md`, and ask.

## Map

- Decisions & governance: `docs/adr/`, `docs/open-decisions/`
- Session history: `docs/implementation/SESSION-LOG.md` — **one entry per PR,
  every PR.** It is the record Claude Code re-derives state from.
- Market/provider layer: `src/lib/market.ts`, `src/lib/marketServer.ts`
- Prompts (v6 committee): `src/lib/prompts.ts`
- Supabase migrations: `supabase/migrations/` — forward only; never edit an
  applied one. Lovable applies them and regenerates
  `src/integrations/supabase/types.ts`; the Supabase connector in Claude Code
  sessions reaches only iCareerOS, **not** this project.
- Execution ledger (§12, §13.1): arithmetic in `src/lib/orders.ts`,
  `fills.ts`, `tranches.ts`, `supersession.ts`; row boundaries in
  `trancheRows.ts`, `fillRows.ts` (validate `kind`/`source` — the generated
  types widen them to `string`); presentation in `ordersView.ts`,
  `supersessionView.ts`; the one write path in `fillDraft.ts`, pinned to
  `fillRejection` by test.
- Hooks: `src/hooks/useAppData.ts` — every table read is account-scoped
  server-side; a client-side filter shows the wrong account for as long as it
  is wrong.

## Current state (2026-09-14)

**HEAD on `main`:** `bbc7407`. Suite **1485 pass / 0 fail**; tsc and
`test:typecheck` clean; boot 200 on the four routes.

**The execution ledger is fully on screen.** #212 (schema + arithmetic, applied
by Lovable 2026-09-12 as `20260912014851_…sql`, byte-identical to
`20260912120000_execution_ledger.sql` which remains as a harmless duplicate) →
#213 tranches on `/portfolio` → #214 supersession on `/decisions` → #215
orders panel → #216 record-a-fill form → #217 session log.

**Standing rules learnt the hard way:**
- Unknown ≠ zero ≠ empty ≠ error ≠ stale. `not_recorded` is its own state.
- A library with no caller is inert code (PERF-001, UNIV-001, `useOrders`
  until #215). Migration first, wiring second; read before write.
- The generated types are honest for columns typed `string` in the domain
  and lie for narrow unions — validate at the boundary and **count** what
  cannot be read; never drop, never default.
- Presentation logic lives in `lib/*View.ts`, not components — mounting a
  component in a test once pulled the browser Supabase client into
  `test:typecheck`.
- `orders.filled_quantity` is the broker's claim; fills are the evidence;
  `reconcileFills` is where they meet. Never write Σ fills back onto the order.

**Open, all Amir's:** OD-001 Amendment 2 (see *Merge authority*); ADR-APP-012
(enforced, never Accepted), 013 (D2 blocks D-10), 014, 015 — all `Proposed`;
86 merged remote branches the git proxy will not let Claude Code delete; the
D-20 catalog query has not been run against `fills`/`tranches`.

**Nothing is buildable without one of those moving.**
