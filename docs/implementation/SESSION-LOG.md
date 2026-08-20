# Session Log — investment-pal (Investment OS capabilities track)

## Session 1 — 2026-08-17/18

### Context
Program pivoted mid-session: the separate multi-tenant `investment-os` platform build
was **deferred** in favor of evolving this live app with Investment OS capabilities at
single-user scale (recorded as **ADR-APP-001**). The v1.1 Certified spec + v1.2 plan
are now a read-only reference library.

### Artifacts created
- **PR [#60](https://github.com/majabri/investment-pal/pull/60)** — `docs/adr/ADR-APP-001.md`
  (pivot decision + carried-over governance), ADR + OPEN-DECISION templates/READMEs,
  `OD-001` (governed co-spec), `OD-002` (free data). Docs-only. _Open._
- **PR [#61](https://github.com/majabri/investment-pal/pull/61)** — price_history foundation:
  - `supabase/migrations/20260818120000_price_history.sql` (RLS, unique per user/symbol/day).
  - `src/components/app/PriceHistoryRecorder.tsx` — daily client capture via the existing
    Yahoo quote layer, mounted on the Portfolio route.
  - `scripts/backfill-price-history.mjs` (+ `scripts/README.md`) — Stooq backfill (free, OD-002).
  - _Open._
- `docs/implementation/SESSION-LOG.md` (this file).

### Tests / verification
- PR #60: docs-only; no code paths touched.
- PR #61: `npm ci` ✔ · `npx tsc --noEmit` ✔ clean · boot check `npm run dev` → `GET /auth`
  **200**, `GET /` 200, no runtime errors ✔ · new files prettier-clean · no secrets committed.
- Note: repo has no lint CI (Lovable builds); `portfolio.tsx` carries pre-existing prettier
  noise that was intentionally left untouched (out of scope).

### Open decisions
- `OD-001` governed co-spec (Approved) — money-adjacent logic needs line-item sign-off.
- `OD-002` free data only (Approved).
- Neither PR is money-adjacent. First sign-off gate is expected around Swing Score /
  buy-back zones (position-sizing bands).

### Merge status
Both PRs opened for review per the agreed flow (agent opens PRs; Amir merges). Nothing
merged to `main` yet. After merge of #61: apply the migration, then run the backfill once
for held symbols (see `scripts/README.md`).

### Also this session (prior, now archived)
Before the pivot, a Phase-0 scaffold for the separate `investment-os` platform was built
and pushed; that repo is now **archived** (read-only) with its spec-intake report and ADRs
preserved for reference.

### Next session
1. **PR2** — evidence-contract columns on `decisions` (action, confidence, evidence JSONB,
   counterargument, key_risks, portfolio_impact, probability_impact, invalidation_conditions;
   nullable) + Action Sheet extractor update. `confidence ≠ probability` (separate columns).
2. Then outcome grading (`price_at_rec` + 1d/1w/1m grades) building on price_history.
3. Committee scorecard → v6 prompt feedback loop.

## Session 2 — 2026-08-19

- **Merged:** #60 (ADR-APP-001), #61 (price_history), and Dependabot #59 (js-yaml 4.3.1 —
  benign security patch, npm-lockfile only). Diligence confirmed #59 is not money-adjacent
  and does not contradict ADR-APP-001.
- **PR2 opened (#63):** evidence-contract columns on `decisions` — migration-only, additive,
  all nullable; `confidence`/`probability_impact` separate columns. Verified `npm install` +
  `tsc --noEmit` + boot 200 (see gate change below).
- **Health finding:** a Lovable sync commit bumped `@lovable.dev/vite-tanstack-config` in
  `package.json`/`bun.lock` but not `package-lock.json`, so `npm ci` fails on `main`. The repo
  is **bun-managed** (Lovable builds from `bun.lock`); the npm lockfile was vestigial.
- **Verification gate updated:** now **`bun install --frozen-lockfile` (npm install fallback)
  + `npx tsc --noEmit` + boot check** — no more `npm ci`. Documented in `CLAUDE.md`.
- **Housekeeping PR:** removes `package-lock.json`, adds `.github/dependabot.yml` tracking the
  **bun** ecosystem, adds `CLAUDE.md`. (Dependabot supports bun *version* updates, not yet
  *security* updates — noted in that PR.)

### Next
- **PR3** — populate the new evidence columns from `extractActionSheet` (action, best-effort
  confidence), leaving the rest nullable. Then outcome grading, committee scorecard.
