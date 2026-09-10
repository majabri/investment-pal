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
npm run dev                      # boot check: GET /auth returns 200
```

Do **not** run `npm ci` (no npm lockfile) and do **not** commit a generated
`package-lock.json`.

## Operating rules

- **GitHub `main` is the single source of truth.** Branch → PR → merge. Small PRs,
  one capability each.
- **Merge authority (Amir, 2026-08-30; line narrowed 2026-09-10).** Claude Code
  may merge its own PRs once CI is green, and may close superseded or duplicate
  PRs, *except* where the change **computes or alters a figure Amir would act
  on** — position sizing, margin math, tax lots, cash/order math, a threshold or
  rate the app itself computes or applies, or the committee mandate. Those stop
  for his explicit line-item sign-off (OD-001), because `main` deploys live
  through Lovable the moment it merges.
  The test is what a change **produces**, not what it touches: handling,
  storing, displaying, validating or protecting a rate is ordinary work and
  merges on a green gate (OD-001 Amendment 1). Doubt about whether a change
  computes a figure still stops; a rate merely being nearby does not.
  **ADRs are never self-merged** regardless (ADR-APP-005 §2).
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
- Session history: `docs/implementation/SESSION-LOG.md`
- Market/provider layer: `src/lib/market.ts`, `src/lib/marketServer.ts`
- Prompts (v6 committee): `src/lib/prompts.ts`
- Supabase migrations: `supabase/migrations/`
