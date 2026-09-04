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

## Session — 2026-08-28 — PR-UI-0: component & accessibility test harness

Handoff item 1 of 4 (Claude Code Handoff — investment-pal — 4 Items, 2026-08-28).
Serves gap **G7** and the Phase 10 accessibility exit gate.

- **Audit correction carried out.** The UIUX-MASTER brief's G7 ("no test script, no
  test files, no axe") was stale. `main` already had `bun test` + `test:typecheck`
  scripts, `tsconfig.tests.json`, three lib tests and a CI boot-gate running all of
  it. Bun's built-in runner is the runner of record; **no Vitest/Jest was added**.
  The real gap was narrower: the harness could test pure functions but could not
  render a component.
- **Added (devDependencies):** `@happy-dom/global-registrator` (DOM),
  `@testing-library/react` + `@testing-library/dom` + `@testing-library/jest-dom`
  (rendering + matchers), `axe-core` (accessibility).
- **`src/test/setup.ts`** — preloaded for every run via `bunfig.toml` `[test] preload`.
  Registers happy-dom before any `@testing-library/*` import, extends `expect` with
  jest-dom matchers, and cleans up the document after each test.
- **`src/test/a11y.ts`** — `assertNoA11yViolations()`, scoped to WCAG 2.1 A/AA and
  reporting rule id, impact and offending markup. `color-contrast` is disabled:
  happy-dom does not compute the Tailwind layer, so the rule returns *incomplete*,
  not *pass* — leaving it on would be a false signal.
- **`src/test/jest-dom.d.ts`** — augments `bun:test`'s `Matchers`. jest-dom ships
  augmentations for jest and vitest only; without this, `toBeInTheDocument` runs but
  is invisible to `test:typecheck`.
- **Widened both tsconfigs.** `tsconfig.tests.json` `include` was `.ts`-only under
  `src/lib/__tests__`, so `.tsx` component tests would have run **untype-checked**
  with CI still green. It now covers `src/**/__tests__/**` (`.ts` + `.tsx`) and
  `src/test/**`; `tsconfig.json`'s matching `exclude` was widened in step.
- **Smoke tests only** — `src/components/app/__tests__/StatCard.test.tsx`: one render
  assertion, one axe assertion. StatCard is a leaf presentational component. The real
  component suite starts in a later PR.
- **No production source file changed.** All `src/` additions are test files.

**Gate:** `bun install --frozen-lockfile` ✓ · `bun run typecheck` ✓ ·
`bun run test:typecheck` ✓ · `bun test` 13 pass / 0 fail (11 pre-existing unchanged
+ 2 new) ✓ · dev-server boot ✓ (`ready in 1363 ms`, `GET /auth` → 200).

Two negative controls were run rather than assumed: a deliberate type error injected
into the `.tsx` test **did** fail `test:typecheck` (proving the widened include works),
and the axe helper **did** throw on a known `image-alt` violation (proving the
assertion is not vacuous). Both probes were reverted.

**Environment note:** this sandbox blocks the Lovable npm mirror
(`europe-west4-npm.pkg.dev`, 403 at CONNECT) and has no IPv6. The gate was therefore
run in a disposable clone resolving those three packages from npmjs (identical
integrity hashes), and the boot check was bound to IPv4. The committed `bun.lock`
keeps all three Lovable registry pins **byte-identical to `main`** — verified
per-entry. CI runs the unmodified gate.

### Next
- **Item 2 — PR-UI-2:** AccountContext + identity removal (~19 sites / 8 files; nine
  in `prompts.ts`, where the IPS mandate itself is hardcoded into committee prompts —
  money-adjacent) + mobile drawer for `AppShell.tsx` `.slice(0, 5)`.
- **Item 3 — ADR-APP-007 (margin rate):** ⛔ blocked pending Amir's four sign-off
  values. Note the ADR number is **007**; 006 is taken.
- **Item 4 — PR-UI-3:** decision card against `recommendation.schema.json`.

## Session — 2026-08-30 — PR-UI-2: AccountContext + identity removal

Handoff item 2 of 4. Closes gap **G1** (portfolio-agnostic violation) and folds
in **G5**'s mobile blocker.

- **AccountContext.** `src/contexts/AccountContext.tsx` holds the selected
  account for every authenticated screen, mounted in `_authenticated/route.tsx`
  and persisted to `localStorage`. Pure selection logic lives in
  `src/lib/accountSelection.ts` so it is unit-testable without React or the
  Supabase client.
- **Fail loudly.** The silent `account_id == null` fallback is gone. On a
  lookup miss screens now render `<AccountNotice>` and no figures, instead of
  showing orphaned manual rows as if they were the portfolio. Screens that
  already counted accountless manual adds *when resolved* still do
  (`includeUnassigned`) — the change is only to the unresolved path.
- **20 identity sites across 8 files** replaced with context reads. `grep -rn
  "Amir - TOD\|Amir-TOD" src/` now returns nothing.
- **Prompt de-hardcoding (money-adjacent).** The mandate was hardcoded in **17
  places** in `prompts.ts` while the same numbers already lived in the `goals`
  row the app lets you edit — so editing the goal changed every screen *except*
  the prompt the model reads. All seven templates are now functions of a
  `Mandate` derived from `goals` (`name`, `starting_value`, `target_value`,
  `target_date`). **No value is invented**; for an unedited goal the rendered
  prompt is byte-identical to before.
- **Mobile drawer.** `AppShell`'s `.slice(0, 5)` left 13 of 18 routes
  unreachable on a phone. Replaced with three thumb-reach primaries plus a More
  sheet rendering every group. Nav model extracted to `src/lib/nav.ts` so
  reachability is a tested property, not a visual one.
- **Category scheme.** `accountCategory()` no longer keys off one account name;
  the `"Amir"` category became `"Primary"`, derived from account shape.

**Gate:** `bun install --frozen-lockfile` ✓ · `bun run typecheck` ✓ ·
`bun run test:typecheck` ✓ · `bun test` **54 pass / 0 fail** (13 pre-existing
unchanged + 41 new) ✓ · dev-server boot ✓ (`ready in 1012 ms`, `GET /auth`
→ 200).

Negative control run rather than assumed: re-hardcoding a single mandate value
in one template **did** fail the "contains no hardcoded objective" test.
Reverted.

**Not done, deliberately:**
- **Margin rates untouched** — `prompts.ts` carries `11.825%` in five places and
  `12.075%` in two, and they disagree. That is ADR-APP-007 territory and blocked
  pending sign-off; this PR does not touch a single rate.
- **Mobile reachability verified structurally**, not by a live authenticated
  render — the sandbox has no credentials for the signed-in shell and adding
  Playwright inside a UI PR is out of policy. Worth one spot-check on device.
- Kids' first names in `accountGroups.ts` / `familyPolicy.ts` left as-is: they
  are family configuration, not an account-identity defect, and the Kids-route
  consolidation is still open under OD-005.

### Next
- **Item 3 — ADR-APP-007 (margin rate):** ⛔ blocked pending Amir's four
  sign-off values. The rate disagreement above strengthens the case.
- **Item 4 — PR-UI-3:** decision card against `recommendation.schema.json`.

---

## 2026-09-03 — Master instruction, four stages, run continuously

Executed `CLAUDE-CODE-MASTER-INSTRUCTION-2026-09-02.md`, which supersedes the
UI-redesign and 4-item handoffs. Per-stage review gates removed; self-merge on
a green gate.

### What merged

| Stage | PR | What |
|---|---|---|
| 1 | #103 | Decisions surface on the canonical 14-field contract |
| 2 | #104 | `investment_universe` replaces the frozen ticker lists |
| 3 | #105 | IA collapse, 18 flat entries → 7 sections with tabs |
| 4 | #106 | Margin rate becomes IPS policy; no rate in code |
| — | #107 | Nine post-merge review defects, all of which reached live `main` |

### Nine defects shipped to `main` before being caught

Recorded because the process failure matters more than the bugs.

Each stage was merged as soon as `boot-gate` went green. The Copilot review on
each PR landed **two to four minutes later**, after the merge — so #104, #105
and #106 each deployed to a live money app carrying real defects, and all nine
findings across those three reviews turned out to be genuine. Every one was
reproduced locally before being fixed in #107.

The three that mattered:

- **The "Held" badge silently disappeared.** The scan list was normalised to
  uppercase while the `held` set was built from raw `holdings.symbol`. A
  position stored as `msft` stopped showing as held — still owned, the screen
  just stopped saying so. Reproduced: `scan ["MSFT"]`, `held ["msft"]`,
  `held.has("MSFT") === false`.
- **`/kids-category/constructor` would have thrown.** `CATEGORIES[category]`
  returned an inherited property, making `config` truthy before dying on
  `config.title`. Now a null-prototype map with an `Object.hasOwn` lookup.
- **The committee could be told `verified not-a-date`.** A malformed date was
  echoed into the prompt as a provenance claim — the exact §27 failure
  `marginCost.ts` exists to prevent. `rateStatus` already knew the date was
  unverified; the prompt line ignored it.

Plus: the Earnings subtitle and row badge still said "watchlist" after the page
moved off it (Opportunities was fixed in #104 and these were missed), the nav
lost its section and tab strip on unknown-category pages, Settings accepted
future verified-on dates, and `KIDS_CATEGORIES` duplicated the map's keys.

**The lesson, stated plainly:** `boot-gate` green is not the same as reviewed.
Waiting the extra two to four minutes per stage for the Copilot review would
have caught all nine before deploy, at a cost of roughly ten minutes total.
Autonomy removed the *approval* gate; it did not remove the *review* gate, and
treating the two as one put defects on a live money screen. #107 was held until
its review came back.

### ADRs written

- **ADR-APP-007** — the margin rate is IPS policy; unset suppresses the cost
  figure and never zeroes.
- **ADR-APP-008** — canonical recommendation contract (14-field, plus
  `objective_id`), and the two deliberate column divergences.

### OD-008 resolved

The 14-field `recommendation.schema.json` in `08 APIs/contracts/` is canonical;
the 10-field copy in `24 Schemas/` is superseded. Recorded in
`docs/open-decisions/OD-008-...` and ADR-APP-008.

### Contradictions found against the master instruction

The instruction asked for these to be reported rather than silently absorbed.

1. **Both schema files are still discoverable in Drive.** Claude Code has no
   write access to the certified repository, so marking the 10-field copy
   superseded remains Amir's action. Until then a future session can still pick
   the wrong one — the defect OD-008 identified is only half closed.
2. **`ADR-APP-006` was already taken** (server-function access controls), as the
   instruction warned. 007 went to margin per the instruction's reservation, so
   the divergence ADR is **008**.
3. **The two 12.075% prompt literals** were not mentioned in the master
   instruction's Stage 4, which named only the two 11.825% sites. There were
   **ten** rate constants in total, not two: the two named, plus eight in the
   committee prompt templates, two of which disagreed at 12.075%. All ten are
   now gone.
4. **The extractor does not write the four new provenance columns.**
   `ips_version`, `model_version`, `prompt_version` and `objective_id` will read
   "Not captured" on new rows as well as old until it does. Visible by design
   rather than hidden; the obvious next piece of work.

### Ticker lists still hardcoded, outside Stage 2

Stage 2 named `earnings.tsx:11` and `opportunities.tsx:13`. Three others exist
and were left alone deliberately:

- `src/lib/data/familyPolicy.ts` — family policy core/preferred names
- `src/routes/_authenticated/watchlist.tsx` — themed watchlist groups
- `src/routes/_authenticated/prompt-center.tsx:209` — a watchlist fed into the
  committee prompt. **This one is worth a decision**: it changes what the
  committee sees, which is closer to money than a screening page.

(`committeeScorecard.ts` matches a ticker-array search but holds action words,
not symbols — a false positive.)

### Still outstanding for Amir

- Enter the current margin rate in Settings. The app ships with it unset: no
  interest cost on the dashboard, and the committee told the rate is unknown.
- Mark the 10-field schema superseded in Drive.
- Delete the stale `ui/pr-0-test-harness` branch — the git proxy in this
  sandbox refuses ref deletions, so it needs the GitHub UI.
- Superseded PRs #99, #100, #101, #102 — see the report.

### Gate

Every stage passed `bun install --frozen-lockfile` → `bun run typecheck` →
`bun run test:typecheck` → `bun test` → dev-server boot. Test count went from
55 to 131 (114 after stage 4, plus 17 regression tests in #107).

Negative controls were run rather than assumed on each new guard:
an unset rate falling back to zero, a `DEFAULT` in the margin migration, a
reintroduced rate constant, and a nav tab removed from the model all fail their
respective tests.

---

## 2026-09-03 (evening) — Master Brief 2026-09-03, five stages

Brief: `CLAUDE-CODE-MASTER-BRIEF-2026-09-03.md` (Drive), verified against
`main @ 287dd5d` — stale by the time it ran; `main` was at `8fae571`. Eight
stages; three were already on `main` and are recorded as such below.

| Stage | PR | Outcome |
|---|---|---|
| 1 · Account-scoped totals | #114 | Merged |
| 2 · Balance import | #115 | Merged |
| 3 · Margin rate governance (delta) | #116 | Merged |
| 4 · One objective | #117 | Merged |
| 5 · Portfolio Summary | #118, #119 | Merged |
| 6 · Decisions surface | — | Already on `main` (#105, ADR-APP-008) |
| 7 · Investment universe | — | Already on `main` (#104) |
| 8 · IA collapse | — | Already on `main` (#103) |

### Where the brief and `main` disagreed

1. **Stage 1: "The app currently omits the debit."** It did not. Both
   `index.tsx` and `portfolio.tsx` already computed `positions + cash −
   margin_used`. The formula was right; the *scope* was wrong.
2. **Stage 1, undocumented and worse:** `useAccount().upsert` wrote to
   `accounts[0]` regardless of selection. Editing "Cash & margin" while looking
   at the IRA wrote those figures onto the first account — a silent
   data-corruption path the brief does not mention.
3. **Stage 3 was already done** (#106 / ADR-APP-007). The rate had already
   moved out of the two constants the brief still names at `index.tsx:269` and
   `MarginCard.tsx:70`. Only the two additions on top of it were outstanding.
4. **Stage 4: the objective was never in three places.** `prompts.ts` was
   already data-driven via `mandateOf` (with `promptMandate.test.ts` pinning
   it). The live duplication was `goals` versus `accounts.target_value`, where
   the latter was editable in Settings and read by nothing.
5. **Stage 5 named `portfolio_snapshots` as the chart source** without noticing
   it carried `scope = 'amir'` — one hardcoded series across every account. The
   same defect Stage 1 removed from every live figure, surviving in the
   recorded history.

### Deliberate departures

- **`accounts.target_value` / `target_date` / `starting_value` are deprecated,
  not dropped.** The brief says delete. Dropping destroys the values
  irreversibly on a database that deploys live on merge. The migration marks
  them with `COMMENT`s and carries the exact `DROP` to run once they are
  confirmed dead. **Amir's call.**
- **The objective stayed in `goals` rather than moving to `ips_lite`.** The
  brief's own alternative ("or make Settings write to the IPS row") applied to
  `main`'s shape: Settings now writes to the goal row, which is what the
  dashboard and the prompts already read. Moving one live objective between
  tables would have dragged money-adjacent `prompts.ts` through a rename.
- **The dashboard was not deleted.** Stage 5 says the summary "replaces the
  Investment Office page". Both surfaces now render the same Portfolio Summary
  panels; `/` keeps buy-back zones, the constitution strip, priorities,
  recommended actions and the workflow launcher beneath them. The brief never
  asked for those to go.
- **Dividends are declared unavailable, with the reason.** No free source
  supplies them (OD-002). The panel says so and warns against reading a blank
  panel as "no dividends due" — as the brief instructs.

### Money-adjacent changes merged under the brief's standing instruction

Stages 1, 3 and 5 all touch money display or a rate. The brief's operating mode
grants self-merge on a green gate, and Amir restated it. Flagged rather than
buried: **the margin rate can now be adopted from a balance import**, as a
separate ticked line item showing the exact value and the date, defaulted on.

### Gate

Every merged stage passed `bun install --frozen-lockfile` → `bun run typecheck`
→ `bun run test:typecheck` → `bun test` → dev-server boot on `/auth`, `/`,
`/summary`, `/portfolio`, `/settings`, `/goals`. Tests went 154 → 255.

Copilot review was awaited on every PR before merging — the lesson from #104/
#105/#106, where merging on a green gate alone put nine defects onto live
`main`. Thirteen review findings across the five PRs, all genuine, all fixed
before merge.

Negative controls run rather than assumed: restoring the unfiltered holdings
select fails six scope tests; re-adding an objective field to the account
payload fails the single-home guard; a `target_value:` write in a third file
fails it too.

### Still outstanding for Amir

- **Apply the three new migrations** (`account_balances`,
  `deprecate_account_objective`, `portfolio_snapshots_account_scope`). Until
  then the reconciliation banner reads "no balances imported" and the summary
  chart records nothing — both degrade honestly rather than erroring.
- **Decide on dropping the deprecated `accounts` objective columns.**
- **Paste a Fidelity balance block** to seed the reconciliation and set the
  margin rate with a real as-of date. The rate ships unset by design.
- **Pre-Stage-5 snapshots stay unattributed.** They are an all-accounts blend;
  the chart says how many exist rather than guessing an account for them.
- **~10 remaining `toISOString().slice(0, 10)` UTC-date uses** (calendar
  windows, price-history "today", the `decisions.decided_on` filter). Same
  class as the bug fixed in #116; the decisions one is money-adjacent.

---

## 2026-09-04 — Master Brief rev. 2, Stage 0 (PR triage) + chart fixes

Brief re-read from Drive: `CLAUDE-CODE-MASTER-BRIEF-2026-09-03.md` **rev. 2**
(new file id `1MTOkA0g…`; the rev. 1 id no longer resolves). Rev. 2 is
byte-identical to rev. 1 apart from the header, the operating-mode line, a new
**Stage 0**, and one addition to the session-close instruction. Stages 1–8 are
unchanged and were all merged on 2026-09-03 (#114–#119).

### Stage 0 — the brief's PR list was stale

Every PR the brief names had already been dealt with **before the brief was
written**:

| PR | Brief says | Actual |
|---|---|---|
| #99 | close it | already closed 2026-09-03 |
| #100 | **keep open**, Stage 6 re-points it | already closed 2026-09-03 |
| #101 | close it | already closed 2026-09-03 |
| #85 | "appears never to have been closed" — close it | closed 2026-08-27 |

Stage 6 shipped anyway as #105 / ADR-APP-008, built to the 14-field schema the
brief specifies, so #100's closure cost nothing.

### What Stage 0 actually found: six open PRs

| PR | Action | Why |
|---|---|---|
| #108 | **closed** | Grouped Dependabot PR (18 updates) — banned under ADR-APP-005 |
| #111 | **closed** | Superseded by #121, which makes the same bump and fixes it |
| #112 | **closed** | TypeScript 7 breaks ESLint outright — see below |
| #110 | **closed** | Superseded by #124, re-gated on current `main` |
| #109 | **closed** | Superseded by #125, re-gated on current `main` |
| #121 | **merged** | recharts 2 → 3, done properly |

### TypeScript 7 is blocked by the ecosystem, not by us

#123 rebased #112 onto current `main` and passed the entire repo gate — `tsc`
clean under 7.0.2, both tsconfigs, 279 tests, production build, boot on five
routes. **It still cannot be merged.** `typescript-eslint@8.67.0` declares
`typescript: >=4.8.4 <6.1.0` and hard-throws:

```
typescript-eslint does not support TS 7.0.
```

CI has no lint step, so nothing in the pipeline would have caught it. Copilot
flagged the peer range; running the linter confirmed it. Tracked upstream at
[typescript-eslint/typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)
for TS ≥ 7.1.

**The general lesson, worth more than the bump:** ADR-APP-005 says a green
`tsc` is not sufficient evidence and the boot check is the real gate. That is
still true and still not enough. The boot check catches runtime breakage that
`tsc` misses; *nothing* catches toolchain breakage that both miss. A dependency
bump's blast radius includes every tool that consumes that dependency's API.

### A live rendering bug, found by looking

The balance-over-time chart on the Morning Brief and the Portfolio Summary was
drawing **axes, grid labels and legend text, and no series at all** — no line,
no fill. Live on `main` since Stage 5b, and inherited from the original
`ProgressChart` before that.

Cause: this theme defines its tokens as complete colours
(`--primary: oklch(0.78 0.14 195)`), not the bare HSL channel triplets shadcn's
default theme uses. `hsl(var(--primary))` expands to `hsl(oklch(…))`, which is
not a valid colour, and the browser drops it silently. The doughnut in the same
card never had the bug because it uses bare `var(--chart-N)`.

Fixed in #122, with before/after browser screenshots and a source guard
(`themeColors.test.ts`) that fails on any theme token wrapped in a colour
function. Negative control run.

**Why it survived so long:** a chart with axes and no line reads as "this
account has no history yet", not as "this style is broken" — and this app has
many legitimate empty states. Nothing in the type system or the test suite can
catch an invalid CSS colour string, and the boot check only proves the route
returns 200.

**Correction:** I first reported this as a recharts 3 regression. It is not —
recharts 2 on `main` produced identical broken output. Verified by rendering the
same fixtures under both.

### Verification method worth reusing

Playwright and Chromium are available in this environment
(`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Rendering the panels in a real
browser via a temporary unauthenticated route — then deleting it — caught a bug
that 279 unit tests, a clean typecheck and seven 200 responses all missed. The
component harness cannot substitute: `ResponsiveContainer` measures its parent
and happy-dom reports every element as zero-sized, so no chart body ever lays
out under test.

### Still outstanding for Amir

Unchanged from 2026-09-03, plus two new items:

- **Apply the three migrations** (`account_balances`,
  `deprecate_account_objective`, `portfolio_snapshots_account_scope`).
- **Paste a Fidelity balance block** to seed reconciliation and set the rate.
- **Decide on dropping** the deprecated `accounts` objective columns.
- **NEW — `.github/dependabot.yml` still configures a `minor-and-patch` group.**
  #108 will keep coming back until that group is removed. The ban currently
  lives in an ADR and in triage; it should live in the config.
- **NEW — CI does not run lint, and `eslint src` reports 1402 problems**
  (1354 errors, 48 warnings, 1340 auto-fixable — almost entirely prettier).
  Identical under eslint 9 and 10. Either add lint to CI and pay the backlog
  down, or accept the config is advisory; right now it is neither.
