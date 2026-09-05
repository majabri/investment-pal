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
  **RESOLVED the same day by #127** (merged 2026-09-04T19:30Z), which removed
  the group and left a comment in its place explaining why the absence is
  deliberate — so a future edit re-adding it has to argue with the file rather
  than rediscover the reason.
- **NEW — CI does not run lint, and `eslint src` reports 1402 problems**
  (1354 errors, 48 warnings, 1340 auto-fixable — almost entirely prettier).
  Identical under eslint 9 and 10. Either add lint to CI and pay the backlog
  down, or accept the config is advisory; right now it is neither.

---

## 2026-09-05 — Master Brief (user-agnostic rebuild), Phase 0: P0 personal-data remediation

Authority: the USER-AGNOSTIC FINANCIAL TRUTH & RECONCILIATION STANDARD (37
rules). Phase 0 is the separate `P0-REMEDIATION-remove-personal-data` brief:
real personal and financial data had been committed to a public repo and sat
there for two days. Three PRs, all merged.

| PR | tier | what |
|---|---|---|
| #136 | 1 + 4 + §4 | real names, balances and figures out of `src/` and `supabase/`; reintroduction guard added |
| #137 | 3 | the office identity in the v5/v6 constitutions becomes configuration (rule 23) |
| #138 | 2 | new users provisioned neutrally; an unset objective stays unset (rule 13) |

### The briefs were repeatedly incomplete, and sweeping beat reading

Every tier found more than the brief listed. Tier 1's file list missed four
files. Tier 3 named four prompt sites; there are **six** — the brief missed
the v6 title line and the v6 body line, both inside template
strings. Tier 2's instruction ("provision no goals row") would have made the
app unusable: there is no create-a-goal path in the UI, so a user with no row
could never set an objective. Trusted `main` over the brief and said so, per the
brief's own closing line.

**Method that worked:** grep the whole tree for the class of defect, then read
the brief to check nothing in it was missed — not the other way round.

### Rule 13 is a schema property, not a display rule

`goals.starting_value / target_value / target_date` were `NOT NULL` with one
person's numbers as defaults. Nullable columns alone are not the fix; five
consumers silently treated `0` as real. `src/lib/objective.ts` now decides
**once** whether an objective is usable, and a *partially* filled objective is
`unset` — computing a required CAGR from two real fields and a default for the
third is exactly the fabrication the nullability exists to prevent.

The progress bar is the clearest case: it used to render at 0%. A bar at zero
claims *no progress*, which is a different statement from *unknown*. It now
renders no bar.

### Fixing half a defect looks exactly like fixing it

The lesson of the session. The unset objective reached the model in two places:
the data block's `Goal:` line, and the **mandate** — seventeen sites across the
v5/v6 constitutions. Fixing the first left the committee reading

> *"maximize the probability of growing the X portfolio from approximately **$0**
> to **$0** by **—**."*

...which is the stronger claim of the two, since it is the mandate rather than a
data field. Copilot found it. The data-block fix had made the PR *look* done.

The repair changed the shape, not just the values: `PromptContext` carries the
`Objective` discriminated union instead of three loose fields. Nullable fields
would have fixed the instance and left the cause — three independently-supplied
values, each with an obvious wrong default to hand.

### Negative controls, again, and the recurring failure mode

Four times now a control has been **coarser than the fault it claims to
disprove**, and each time the test was passing for the wrong reason:

- #134: the row fixture was already canonical, so deleting the normaliser
  changed nothing.
- #136: the guard's allowlist was per-*file*, hiding a real figure in a file
  exempted for a different needle. Now per file **and** per needle.
- #138: `expect(out).toContain("NOT SET")` passes regardless — the margin-rate
  line already says it. Anchored to the goal line, the control then bit.

**The rule this settles into:** a control must inject the *precise* fault. A
coarser one (breaking matching outright rather than removing normalisation)
proves only that the test runs.

### Found outside the brief, higher severity than what it targets

Not touched, and reported to Amir for decision:

- **Children's names are load-bearing in application logic** —
  `accountGroups.ts` classifies accounts by matching a hardcoded list of first
  names, and the same names are interpolated into prompts. Phase 1b removes
  this as a side effect of classifying on metadata rather than names.
- **Three minors' birth dates** in `familyPolicy.ts`, money-adjacent via
  age-based allocation.
- **Account-number-shaped strings** in `kidsSeed.ts`.
- **Git history** still contains everything removed. §5's `git filter-repo` and
  force-push is explicitly Amir's decision and was not attempted.
- One **applied** migration's comment still names him; not edited in place
  (checksum risk), so it needs a forward migration or acceptance.

---

## 2026-09-05 — Master Brief (user-agnostic rebuild), Phase 1: financial truth foundations

Seven PRs. `main` deployed live after each.

| PR | part | what |
|---|---|---|
| #140 | 1a | `accounts` money columns lose `NOT NULL DEFAULT 0`; eight consumers stop reading the resulting NULL as a real zero |
| #141 | 1a-ii | the prompt surfaces, including per-holding concentration |
| #143 | 1b | account metadata; the one inference runs in the migration and is recorded |
| #145 | 1b-ii | the editor that turns a guess into an answer |
| #147 | 1b-iii | classification reads type, not name; every hardcoded name list gone |
| #148 | 1c | no brokerage assumed by the schema |
| #149 | 1d | provenance — a figure's age is part of the figure |

### The whole phase was one defect wearing different clothes

**The app could not say "I don't know."** Not for a balance, not for an
objective, not for what an account is, not for how old a figure is. Every part
of Phase 1 was the same two-step: make the unknown expressible in the schema,
then find everything above that quietly converts it back into a confident
number.

The second step was always the larger one, and it is not a typing problem.
`?? 0` accepts `null` without complaint, so **TypeScript surfaced exactly one
of the eight sites in 1a.** The rest were found by reading. A schema change
that "compiles clean" has told you nothing about whether the meaning survived.

### Governance checks that pass because they checked nothing

The most serious single line in the phase was `const equityPct = totals.equityPct ?? 1`.

Assuming FULL equity when it is unknown makes the "equity below 50%" breach
unfireable on exactly the accounts whose data is missing — so the dashboard
reported `Constitution: clean` having been unable to evaluate a single limit.
The same shape appeared twice more: per-holding concentration rendering
`0.0% of acct` (telling the committee nothing breaches the position cap, from a
denominator nobody supplied), and reconciliation receiving `?? 0` and reporting
a discrepancy the size of the whole account.

**A check that cannot fail is worse than one that does**, and all three read as
reassurance.

### Three places `main` was right and the brief was wrong

Recorded because the brief's own closing line asks for it:

- **The account-type vocabulary.** The brief proposes a coarse set; `main` has
  nine values the Settings editor already writes. Adopting the brief's would
  have made every existing account fail the new CHECK the next time someone
  pressed Save — a production database error on the screen whose only job is
  recording what an account is. Kept main's, added `529` and `crypto`: the two
  categories the name-matcher could *see* and the metadata could not *record*.
- **`provider` and `display_name`.** Already present as `broker` and `name`.
  A second column for either would have drifted from the first.
- **`name NOT NULL`.** The brief's instinct — make the unknown expressible —
  does not transfer from balances to labels. A missing balance is a fact about
  money and must stay expressible; a missing label has no honest rendering, as
  it cannot be picked in a switcher or named in a prompt.

### Two absences that are not the same absence

`—` means NO SCOPE: no account is selected, fixed by choosing one. `Unavailable`
means an account IS selected and the figure is genuinely not known, fixed by
importing a balance. Prompt text uses a third register, `NOT KNOWN`, because a
model reads it: a dash there is guessed at and `$0.00` is believed.

`fmtUSD`/`fmtPct` are the leak. They accept `null` and return `—` rather than
failing, so every site that forgets the distinction degrades silently into the
no-scope glyph — and the type system cannot help, because `number | null` is
exactly what they take. **Review caught this four separate times across the
phase.** Making the formatters reject `null` is the structural fix; it touches
every formatting call in the app and is the first item on the Phase 3 list.

### Unknown is not stale

Phase 1d's six states exist because the actions differ. The pair that earns its
keep is UNKNOWN vs STALE: they look identical on screen and send the user to
different places — record provenance, or import again.

Two details worth carrying forward. A missing value is UNAVAILABLE *before*
provenance is consulted, because reporting a missing figure as "current"
fabricates a value AND vouches for it. And a figure stamped in the FUTURE is
UNKNOWN, not CURRENT: a clock error must not read as the best possible data.

### What review caught that the author did not

Copilot found 14 defects across these PRs. Three are worth recording as classes:

1. **A `NaN` I introduced.** `<input type="number">` permits `-`, `.` and `1e`
   mid-entry, each parsing to NaN — and NaN in a NUMERIC column is neither a
   figure nor an honest absence.
2. **A rule stated in a PR description and broken in the same PR.** The
   two-vocabulary rule above, violated in the two prompt builders the PR existed
   to fix. Root cause: the rule lived in prose while the wording was duplicated
   as a literal at each call site. Both now live in one module.
3. **A correction that made the record worse.** The Phase 0 entry claimed "four
   PRs" over a table of three; the fix added #127 — which merged the day BEFORE
   the P0 brief. Checking the primary source rather than the reviewer's summary
   is what caught it. Phase 0 was three PRs.

The recurring own-goal, now four instances deep, is **a guard or control coarser
than the fault it claims to catch.** The newest example: a source guard for
"nothing re-infers at runtime" written as `not.toContain("inferred_from_name")`,
which fired on a comparison that READS the value to pick a tooltip. Narrowed to
match an assignment — and it now also asserts the read is present, because
reading it is how the UI knows which accounts to ask about.

### Still outstanding for Amir

- **`src/lib/data/familyPolicy.ts` holds three minors' names and birth dates.**
  Now the only personal data left in `src/`, and the brief's standing
  constraints make it a permanent-rule violation rather than a backlog item.
  Phase 1b removed the account-classification dependency on names; this file
  survives because `/kids` reads the birth dates for age-based allocation. The
  fix is rule 22's household model (Phase 4) pulled forward, which would empty
  `/kids` until it is populated — hence a decision, not a default.
- **Confirm the account types.** Every existing account carries either
  `inferred_from_name` or `legacy_default`. Both are the app's own guesses; the
  Settings banner names them.
- **Apply the migrations.** Phase 1 adds four on top of the three already
  pending.
- **Git history** still contains everything the P0 remediation removed (§5).
- **CI still does not run lint**, unchanged from 2026-09-04.

---

## 2026-09-05 — Master Brief (user-agnostic rebuild), Phases 2 and 3: the canonical model, the adapter contract, and one accounting engine

Six PRs.

| PR | part | what |
|---|---|---|
| #151 | 2a | the canonical model, and what each broker field may mean |
| #152 | 2b | the adapter contract, proven with a synthetic second broker |
| #153 | 3-pre | the formatters take a `number`, not `number \| null` |
| #154 | 3b | the reconciliation engine, seven states |
| #155 | 3a | one accounting engine; five screens stop recomputing |
| #156 | 3d | the reconciliation panel |

### "Verified against Fidelity" meant one sample that happened to reconcile

The brief named the defect precisely and it was worse on inspection. The
equity formula in `accountTotals.ts` was documented as verified because a
single real statement's numbers added up. That is curve-fitting: with enough
fields, several wrong formulas reproduce one sample.

The fix was not a better formula. It was **saying, per field, what is
actually known about it** — and admitting that for most of them the answer is
"less than the arithmetic assumed". `canonicalBalances.ts` ended up with a
three-value `SemanticBasis`:

- `checked_identity` — the field participates in an identity that can be
  checked against other fields on the same statement;
- `reported_scalar` — the broker reports it and the app stores it, but nothing
  independently confirms what it means;
- `unsupported` — the meaning could not be established, so it is excluded from
  equity entirely.

**Exactly three fields came out calculable.** Everything else is stored,
displayed, and kept out of the equity computation. That is a smaller app than
the one that shipped, and a truthful one.

Two attempts to establish the definitions from Fidelity's own documentation
failed: the egress proxy blocks `fidelity.com` and `www2.advisorchannel.com`.
Recorded as blocked rather than filled in from memory — a remembered
definition presented as the broker's is exactly the class of claim this phase
exists to remove.

### The second adapter is the test, not the feature

Rule 3 asks that a second broker be addable without touching portfolio logic.
The only honest way to check that is to add one, so #152 ships a synthetic
second-broker fixture in tests. It has different field names, a different sign
convention on margin debt, and one field the contract marks unsupported.

The contract has a single `read` method rather than `parse` / `validate` /
`map`, for one reason: three methods let a caller skip validation and still
get a canonical record. One method cannot be half-used.

### Making the formatters reject `null` was the largest mechanical change

`fmtUSD(v: number | null)` returning `—` was flagged four separate times in
Phase 1 as the thing that made every unknown-value bug silent. #153 changed
the signature to `number` and let the compiler find every site — several
hundred — that had been relying on the fallback.

The replacement for a non-finite input is `(error)`, not `—` and not `$0.00`.
A NaN reaching a formatter is a bug in the caller, and a dash hides it while
`$0.00` states it as a fact.

### Precedence is the whole design of the reconciliation engine

Seven states, and the order they are evaluated in matters more than the
thresholds:

```
unsupported → missing data → staleness → tolerance bands
```

A stale figure that also fails the tolerance check is STALE, not
NOT_RECONCILED: telling someone their books disagree by $4,000 when the real
problem is that one side is nine days old sends them to fix the wrong thing.

Tolerance fires on **either** dollars or percentage, which is what makes
rule 31 hold: a $300 gap on $5,000,000 is 0.006% and must still be material,
and $0.01 of rounding on $500 must not be. A test asserting the first case
was written badly the first time — $5,000 on $5m is 0.1%, already over the
percentage threshold, so it passed with the dollar check deleted. The control
caught it; the test was rewritten to $300 with an explicit assertion that it
sits below the percentage band.

### "Leverage against nothing is undefined, not infinite"

`accountTotals.ts` gained `liabilities`, `availableCapital`,
`availableWithoutBorrowing`, `leverage` and `marginUtilisation`. Two decisions
worth keeping:

- `availableCapital` is the **broker's own buying-power figure**, never
  derived. Deriving it means inventing the broker's margin rules.
- `leverage` is `null` when equity is zero. Not `Infinity`, which renders, and
  not a large number, which reads as a reading.

The panel in #156 removed the line "Treat the broker's figure as correct."
Rule 5 says do not assume either value is right; a panel that tells the user
which side to believe is not a reconciliation panel, it is a preference.

### The recurring own-goal, twice more

A guard coarser than the fault it claims to catch — instances five and six.

In #155 the guard flagged **its own documentation**: the comment explaining
which arithmetic had been removed necessarily quotes that arithmetic. Fixed by
stripping comments before matching, and the reason is worth stating plainly —
*a guard that fires on the explanation pressures the next person to delete the
explanation*, which leaves the codebase with the rule and without the reason
for it.

---

## 2026-09-05 — Master Brief (user-agnostic rebuild), Phase 4: the configuration layer

Four PRs. This is the phase that removed the last of one household from the
application.

| PR | rules | what |
|---|---|---|
| #157 | 22 | household membership becomes data; nobody is assumed |
| #158 | 20, 15 | goals are data, per account; unset means unset |
| #159 | 15, 21 | policy classes and provenance — a default is labelled a default |
| #160 | 16, 21 | strategy rules become data; the core stops knowing about them |

### One file was the whole phase

`src/lib/data/familyPolicy.ts` held, in a single frozen object:

- **who** — three children's first names and birth dates;
- **the goal** — $200,000 per child, $600,000 for the family, a 2036 horizon,
  $100 every fourteen days from a fixed anchor;
- **the strategy** — 28 tickers in four buckets, a 5% speculative cap, a
  parity rule, and scoring weights nothing read.

Every user of the app inherited all of it, and **no screen could tell it had
been made up.** `/kids` rendered three named children with hand-copied
positions when no accounts had been imported, and labelled the result "seeded
2026-07-21". The committee prompt named those children, by name and age, to a
model, in the first person, and asked it to vote BUY/HOLD/SELL on each.

The file is now two parameterised functions and is renamed `objectiveMath.ts`.

### The consequence was the reason it took six flags to move

This was reported to Amir six times across Phases 1–3 and never answered,
because the fix empties screens: `/kids`, `/kids-watchlist` and
`/kids-prompt-center` show empty states until a household, targets and a
strategy are entered. Phase 4 point 5 of the brief — *"No assumed
dependants"* — is the explicit authority that made it a decision already
taken rather than one still open.

Worth stating for the next time this shape appears: **an empty screen that
says what is missing is not a regression from a full screen that is wrong
about whose money it is.**

### A guard cannot use the value it is guarding

`personalData.test.ts` lists literal needles — a name, a balance figure — and
fails when one reappears. The obvious extension was to add the three
children's names and birth dates.

That would have put them back in the public repository. The guard would have
become the leak.

So the roster gets **structural** guards instead (no `children:` array, no
literal birth date, anywhere under `src/lib`), and the account numbers get a
**shape** needle — `\bZ\d{8}\b` — which costs nothing to state and catches
siblings nobody has seen. The owner's own first name stays a literal needle
because it already was one and it is his own; the asymmetry is deliberate.

### Rule 13 keeps finding new denominators

Three more sites, all the same shape and all previously unreachable:

- `[].reduce((s, k) => ..., 0)` returns **0**, so a household with no
  custodial accounts would have shown `$0.00` against a $600,000 target with a
  0% progress bar. Unreachable before only because a compiled-in seed
  guaranteed three accounts.
- `approvedShare = ... / Math.max(1, mv)` returns **0** for an empty account —
  "0% in approved names", a failing grade — and would have returned the same
  for any user who had not configured a strategy.
- `ageOf` returned `number`, so a missing birth date produced `NaN` and a
  future one produced a negative, and **both rendered as an age**.

The pattern: a denominator or an accumulator that cannot distinguish "nothing
to measure" from "measured, and it is zero". Each was invisible while a
hardcoded constant guaranteed the input was never empty. **Making something
configurable makes its empty case reachable for the first time** — that is
where to look next time.

### Rule 15 is not "remove the defaults"

The 30% position cap and 25% margin cap are ADR-APP-004's signed-off defaults
and they are legitimate. What was not legitimate is that nothing could tell
them from a choice: Settings pre-filled them, the dashboard flagged
`NVDA 34.2% > 30% cap` as though the user were breaching their own commitment,
and the committee prompt stated them under "HARD GOVERNANCE" — all of it
whether or not anybody had ever opened the form. The prompt template's
`${ctx.ipsPositionCapPct ?? 30}` meant a caller that simply *forgot* the caps
still asserted a 30% limit as the user's policy.

The fix is a provenance column and four states, not a deletion —
`accounts.account_type_source` from Phase 1b, again. `legacy_unknown` for
existing rows is the honest answer: those values may be a choice or may be the
schema default, and the app cannot tell retroactively.

### Rule 21's distinction is not cosmetic

Before this phase the dashboard listed the Reg-T 50% maintenance floor in the
same breach line, in the same words, as two caps the user may move. An app
that presents a regulatory constraint identically to a self-imposed one
invites somebody to "adjust" the one they cannot adjust.

### Rule 16 is checkable, so it is checked

"Strategies sit on top; they never redefine the financial model" is a claim
about imports. A test lists the accounting modules and asserts none of them
imports strategy configuration — with a control proving the import scan finds
the imports that *are* there, and another proving it *would* flag a strategy
import.

### A guard pinned to a path stops guarding when the path moves

#160 renamed `familyPolicy.ts`. Two source guards read that file **by path**
and would have thrown — loudly, in this case, which is the good outcome. But
the lesson generalises: both were re-pointed to scan all of `src/lib`, which
is where the data would go if it came back and which survives the next rename.

One needle had to be narrowed in the process. `familyTarget` is now a
legitimate local holding the *derived* household target, and a guard on the
bare identifier flagged it — which would have pushed the next person to rename
a correctly-named variable to satisfy a test. Guards must not make the code
worse to keep them quiet.

### An earlier decision reversed, on purpose

The P0 remediation added "the objective has exactly one home", forbidding any
objective field from being written to `accounts`. Sound at the time: nothing
read those columns, so the Settings editor looked like setting a target and
set nothing.

Rule 20 puts a goal at account scope and `/kids` now reads it, so the guard
was **narrowed rather than deleted**: `starting_value` is still never written
to an account, and `target_value` / `target_date` only from the account
editor, per file **and** per field. A per-file exemption would have handed
`settings.tsx` `starting_value` too; a control asserts it did not.

The first replacement control I wrote for that exemption — "these files
contain no mutation" — **was wrong and failed on its first run**: `useAppData`
is the hooks module and obviously mutates. The claim that actually needed
holding was narrower: in those files an objective field only ever appears as a
*type declaration*, never as a key assigned a value.

### Still outstanding for Amir

- **Apply the migrations.** Phase 4 adds four (`household_members`,
  `account_objectives`, `policy_provenance`, `strategy_config`) on top of the
  seven already pending from Phases 0–3. Nothing in Phase 4 backfills a value:
  every new column is NULL for every existing row by design.
- **Populate the configuration.** `/kids`, `/kids-watchlist` and
  `/kids-prompt-center` are empty until household members, per-account targets
  and a strategy are entered in Settings. This is the rule, not a regression,
  but it is your data to enter.
- **Confirm the IPS-lite caps.** Every existing row is `legacy_unknown` — the
  app cannot tell your choice from the old column defaults. Saving the
  Settings form once resolves it.
- **Confirm the account types.** Unchanged from Phase 1: every account still
  carries `inferred_from_name` or `legacy_default`.
- **Copilot review is exhausted.** From #157 onward: *"unable to review — the
  user who requested the review has reached their quota limit."* Phases 0–3
  had ~14 defects found by review; Phase 4 had none found that way, and the
  difference is not that the code got better.
- **Git history** still contains everything the P0 remediation removed (§5).
- **CI still does not run lint**, unchanged since 2026-09-04.

---

## 2026-09-05 — Master Brief (user-agnostic rebuild), Phase 5: truth gates

Four PRs.

| PR | rules | what |
|---|---|---|
| #162 | 17, 30 | the readiness gate |
| #163 | 17 | multi-account readiness — closes the gap #162 named |
| #164 | 18 | AI is downstream, by construction |
| #165 | 30 | coverage unavailable is not the same as none |

### Rule 17 is a dependency table, not a switch

Two failure modes, pulling in opposite directions. The one the app had:
recommendations produced from whatever data happened to be present, because
nothing checked and so nothing could refuse. The one an over-eager gate would
introduce: the news page unusable because a quote is stale — and **a gate
people route around is not a gate.**

So the unit is a CAPABILITY, not a screen. `research` and `reporting` depend on
nothing and can never be blocked; `position_sizing` depends on all seven
checks; `goal_projection` on positions and quotes only. Two screens, two
capabilities, two different sets of blocking inputs, from one table.

**Three check states, not two.** `fail` means the check ran and the data is
wrong — investigate. `unknown` means it could not run — import. They block
equally and report separately, because the fix differs. Collapsing them is the
same conflation rule 13 forbids everywhere else.

Two calibrations that took thought:

- **`UNSUPPORTED` reconciliation is `unknown`, not `fail`.** An account with no
  broker figure can never reconcile; treating "no such comparison exists" as a
  fault would block every manually-tracked account forever.
- **A `WARNING` reconciliation passes.** Rule 11 made WARNING the band worth
  seeing and not worth alarming; blocking on it would block on rounding drift
  at scale.

### A banner is not a gate

A panel above a prompt that still asks for position sizes against unverified
data does nothing. `PromptContext` gained a REQUIRED `readiness` field, and the
brief opens with a block naming each unverified input and instructing the model
not to substitute a figure, not to infer one from the others, and not to assume
a missing figure is zero — while saying explicitly that research remains in
scope, or the model refuses everything and the brief is worthless.

Required rather than optional because rule 18 is why it is an INPUT: the gate
is deterministic and the model cannot argue with it.

### Rule 18: I found no violation, and that was the finding

The one place a model's response becomes a row happens to write only
recommendation columns. **"Happens to" is the problem.** Nothing prevented the
next person adding `cash: parsedFromResponse`, and nothing would have noticed.
A model told the cash balance is NOT KNOWN will helpfully estimate one, and an
estimate written into `accounts.cash` is indistinguishable from an imported
figure the moment it lands.

The boundary throws rather than filtering — dropping the field silently would
leave the caller believing it was saved — and matches by column NAME across all
tables, because the point is not that `accounts.cash` is protected but that a
column called `cash` anywhere is a claim about money.

`decisions.price_at_rec` is the interesting case: it IS a price and it IS
allowed, because the extractor reads it from the live quote map rather than
from the response text. The boundary can see what a value is called, not where
it came from, so the column sits in `PROVENANCE_EXEMPT` with the argument
attached and a test asserting the argument is still true of the source.

### Rule 30 found four live bugs, all the same line

```ts
const { data: events = [], isLoading } = useQuery(...)
{!isLoading && events.length === 0 && <p>No earnings…</p>}
```

React Query settles `isLoading` to false when a query FAILS, and the `= []`
default fills in. So on a fetch error `/geopolitics` said "Nothing
market-relevant right now.", `/earnings` said "No earnings for these names in
the next 14 days.", `/economic-calendar` and `/news` rendered empty with no
message, and the committee prompt told a model `- (none)`.

**"No earnings this week" is a reason to hold through the week. "We could not
reach the source" is a reason to check first.**

`coverageOf` takes the QUERY, not its defaulted data, because `isError` alone
is not enough: a query can settle with `data` undefined and the caller's `= []`
then makes that indistinguishable from an empty result. And an empty array that
WAS fetched stays AVAILABLE — that is a real answer and must not be swept up.

The wording is the fix, not the state: the notice says what it is NOT ("this is
not the same as there being none"), because without that clause a user reads
"unavailable" as "none" anyway.

### A Phase 4 miss, found by sweeping

Six tickers hardcoded into the earnings-calendar lookup in `prompt-center`,
appended to every user's holdings. The Phase 4 guard scans for
`core: ["MSFT", …]`-shaped DECLARATIONS; these were an ARGUMENT TO A FETCH.
Worth carrying forward: a guard written against the shape a defect took last
time will not find the same defect in a different position.

---

## 2026-09-05 — Master Brief (user-agnostic rebuild), Phase 6: orders, tranches, import safety

Three PRs, and the last one fixes data loss that was shipping.

| PR | rules | what |
|---|---|---|
| #166 | 19 | broker-neutral order model; `openOrdersKnown` stops being a literal |
| #167 | 19 | lots and tranches |
| #168 | 29 | import safety — atomic, account-scoped, theses survive |

### The order model was a truth-gate fix, not a feature

`readiness.ts` hardcoded `openOrdersKnown: false` for every caller because
there was no data that could make it true. That was the honest value AND a
permanent block on the position-sizing capability.

**The distinction is not "are there orders" but "has anybody told us."**
`accounts.orders_as_of` records when the app was last told; an account whose
orders were read and reported nothing working IS known to have none, and an
account nobody has read is not. A count of rows cannot tell those apart, which
is why an empty table never becomes "no open orders".

Three calibrations:

- **`unknown` is a real status and counts as COMMITTED.** An order whose state
  the adapter could not map might be working, and treating it as closed frees
  capital the app cannot prove is free.
- **`committedCash` is null for a working MARKET order, not zero.** A screen
  reporting $0 committed against three working market orders tells the user
  capital is free that is not.
- **An over-fill is deliberately not rejected by a CHECK.** It is a data
  problem to surface, and a constraint would discard the evidence.

### The tranche rule loses money in both directions

A stop entered against one lot but read as covering the whole holding leaves
far too much size APPARENTLY protected. A position-wide stop taken for a
tranche stop leaves the rest APPARENTLY unprotected. `holdings` — one row per
symbol, one blended cost basis — cannot express the difference.

`lotCoverage` has four answers because two of them are what a boolean loses:
`not_recorded` (composition unknown — a tranche-scoped stop cannot be placed
safely), `incomplete`, `mismatched` (a finding to surface, never a number to
adjust), `complete`. **A position with no lots is not a position of one lot.**

`holdingPeriod` returns null for a missing acquisition date rather than
"short_term". Defaulting to short-term LOOKS conservative and is not: it
understates the after-tax value of a sale the user may be told to make, and it
is a claim about their tax position nobody supplied. Exactly one year is
short-term — the US rule is strictly more than a year, and inverting it
misstates a tax bill.

### The import audit found four violations, three of them live

Rule 29 asks for atomic, account-scoped, previewed, auditable. The Portfolio
CSV import was none of those:

1. **Not atomic.** DELETE-then-INSERT per account in the client, no
   transaction. A failure between them left that account with NO POSITIONS and
   every later account untouched — a portfolio in two states, one of them
   empty, under a toast saying the save failed.
2. **Theses did not survive.** The delete dropped `original_thesis`,
   `current_thesis`, `why_own`, `notes`, `sector`, `last_ai_review` and
   `last_reviewed_at` for every symbol on every import. Rule 29 names this
   exactly, and a reason for owning a position is not recoverable from a broker
   export.
3. **An import touched other accounts.** "Overwrite entire portfolio"
   defaulted to ON and deleted every holding the user had, including accounts
   the import was not mapping and could not restore.
4. **Unknown cash was written as zero** — the Phase 1a defect, still live in
   the path that writes money most often.

The fix is one Postgres function that is the only way positions are written.
UPDATE-then-INSERT rather than DELETE-then-INSERT is the whole mechanism: the
narrative columns are simply not in the SET list, so they survive untouched.

`NARRATIVE_COLUMNS` is listed in TypeScript so a test can assert the SQL
function's SET list excludes every one. **Two places that must agree, in two
languages, is exactly how a rule like this rots.**

### The recurring own-goal, instance seven, caught by its own run

A test asserting the open-orders detail never claims "no open orders" fired on
the detail's own EXPLANATION — "it cannot tell an account with no open orders
from one whose orders it cannot see". Narrowed to the claim (the phrase at the
start of a sentence), with a control proving it catches the claim and spares
the explanation.

Instance eight was worse and is worth recording separately: a control I wrote
for the shape-only exemption list — "these files contain no mutation" — was
simply the WRONG CLAIM, and failed on its first run because `useAppData` is the
hooks module and obviously mutates. The claim that needed holding was narrower:
in those files an objective field only ever appears as a TYPE DECLARATION,
never as a key assigned a value. Writing the control first is what surfaced it.

### Still outstanding for Amir

- **Fifteen migrations pending.** Phases 5–6 add four (`orders`,
  `position_lots`, `import_safety`, plus the Phase 4 four) on top of the eleven
  already waiting. Nothing backfills a value; every new column is NULL for
  every existing row by design.
- **The import fixes are only live once the migration is applied.** Until
  `import_account_positions` exists in the database, the CSV import will fail
  rather than silently doing the old thing — the client no longer contains the
  old path.
- **Populate the configuration.** `/kids`, `/kids-watchlist` and
  `/kids-prompt-center` stay empty until household members, per-account targets
  and a strategy are entered.
- **Confirm the IPS-lite caps and the account types.** Both are still
  `legacy_unknown` / `inferred_from_name`.
- **Copilot review has been unavailable since #157** ("quota limit"). Eleven
  PRs have now merged on the gate and my own reading alone.
- **CI still does not run lint.** `eslint src` reports pre-existing problems
  across the tree; every file touched in this session is clean, and the rest
  are not.
- **Git history** still contains everything the P0 remediation removed (§5).

---

## 2026-09-05 — Master Brief (user-agnostic rebuild), Phases 7 and 8: precision, currency, and the proof

Three PRs, and the programme's close.

| PR | rules | what |
|---|---|---|
| #170 | 32, 33 | precision by instrument; currency stated rather than assumed |
| #171 | 24, 34, 36, 37 | synthetic regression suite, repository audit, the second-user test |
| #172 | — | four ADRs, **proposed and deliberately unmerged** |

### Both Phase 7 defects were in one function

```ts
export const fmtUSD = (v: number, digits = 2) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", ... });
```

Called from every screen. The global two-decimal rounding rule 33 forbids AND
the USD assumption rule 32 forbids, in one line.

What the two decimals cost: a crypto price of $0.00003412 renders **$0.00** —
an erasure, not a rounding — and $0.0042 and $0.0038 render identically, so a
10% move is invisible on the screen whose job is showing moves. A test asserts
`fmtUSD` returns the same string for both and `fmtPrice` does not.

Two calibrations worth keeping. **The class table is a floor, not a ceiling**: a
"penny" price of 0.00004 still needs more than four decimals, and stopping at
the class default would render "$0.0000", the same erasure in a different coat.
And **`unknown` gets the MOST precision, not the most common** — losing digits
is irreversible, showing extra is untidy, and that asymmetry decides the
default.

`classOf` deliberately does not read the ticker. Rule 8 forbids inferring
behaviour from a label and a symbol is a label; the real source is an instrument
record the adapter would supply, which does not exist and is **honestly absent
rather than faked**.

### A bug I shipped, found by the test I wrote for it

`roundForDisplay` started as the obvious `Math.round(v * 10**d) / 10**d`. That
is wrong at exactly the boundary a person checks: `1.005 * 100` is
`100.49999999999999` in binary floating point, so it rounds **1.005 down to
1.00** and somebody reports a penny missing.

Fixed via the decimal string, with a control pinning that the obvious
implementation fails — so a future simplification has to argue with the test
rather than just look tidier.

### The rule-37 test found the defect it exists to find

Two synthetic profiles: a margin brokerage with a US-equity strategy, a
ten-year horizon and a dependant; and a cash-only EUR crypto account with a
short horizon, no household, no contribution plan and unconfirmed caps.

`accountTotals` treated `margin_used: null` as unknown unconditionally, so **a
cash-only account's total value read "Unavailable" forever** — with no action
the user could take, because no import will ever supply a debt figure for an
account that cannot have one.

`margin_enabled === false` is a **stated fact**, not an absence. Null debt now
means zero debt in exactly that case; NULL `margin_enabled` still means unknown;
and an explicit debit still wins over the flag, because a debt on a cash-flagged
account is evidence of a data problem and must survive to be seen.

That is precisely the shape rule 37 is about: **the app worked for a margin user
and quietly did not work for a cash one.** No amount of testing the first
profile would have found it.

The regression suite also caught a `now`-propagation bug: `readinessInput.ts`
passed `now` to the reconciliation input builder but not to the engine, so
quotes were stamped at the caller's clock and staleness measured against the
real one. Invisible in production, where both are the same moment.

### The audit's uncomfortable finding

Twenty-one places one broker's name reached the user — "Copy the balances block
from Fidelity", "Owed to Fidelity", "never connects to your Fidelity login",
`placeholder="Fidelity"`. And one reached a **model**: the committee mandate
instructed *"Ignore all other Fidelity accounts"*, asserting the user's broker to
the thing being asked for advice.

The report classifies all sixty occurrences and — the part that matters for the
next sweep — **argues for the twelve it retains**. "Think like: BlackRock,
Berkshire Hathaway, … Fidelity Active Management" is a style reference for a
model, not a claim about anybody's broker, and replacing it makes the prompt
worse.

### Why #172 is not merged

ADR-APP-005 §2: *"Any ADR itself (proposing/accepting an ADR is Amir's call)."*

The master brief's standing instruction authorises self-merging implementations
on a green gate. It does not authorise ratifying the decisions behind them, and
the two are not the same permission. All four ADRs are **Proposed** and the PR
waits.

Worth stating plainly because the temptation ran the other way: fourteen PRs
merged in this session on the gate and my own reading alone, several of them
money-adjacent. That an agent may merge code under a standing instruction is not
an argument that it may accept the architecture decisions the code implements.

### What eight phases actually changed

The 2026-09-05 leak was never really about privacy. **The app could not say "I
don't know."** Not for a balance, an objective, an account's type, a figure's
age, a household member, a strategy, an order, a lot, or whether a source had
been read at all. Every gap was filled with a number, and every filled gap
looked exactly like a fact.

Two practices earned their place and are recorded in ADR-APP-012:

1. **Every guard needs a negative control.** Nine instances caught of a guard
   coarser or plainly wronger than the fault it named — several firing on their
   own explanatory comment, one whose claim about the code was simply false and
   failed on its first run. *A guard that fires on the explanation pressures the
   next person to delete the explanation.*
2. **Making something configurable makes its empty case reachable for the first
   time.** Every rule-13 bug found after Phase 1 arrived this way.

### Still outstanding for Amir — the whole list

**Blocking, and both yours:**

- **Fifteen migrations pending.** Until applied, the app cannot express most of
  what moved into data — and **the Portfolio CSV import will fail**, because the
  client no longer contains the old unsafe path. Deliberate: failing loudly
  beats silently dropping every thesis again.
- **Git history** still contains everything the P0 remediation removed. §5
  reserves it for you and it was not attempted.

**Waiting on a decision:**

- **#172, the four ADRs.** Proposed, unmerged, per ADR-APP-005 §2.

**Configuration you need to enter:**

- Household members, per-account targets and a strategy, or `/kids`,
  `/kids-watchlist` and `/kids-prompt-center` stay empty.
- The IPS-lite caps: every row is `legacy_unknown`, so the app cannot tell your
  choice from the old column defaults. Saving the form once resolves it.
- Account types: still `inferred_from_name` or `legacy_default`.
- `margin_enabled` per account — it is what lets a cash account report a total.

**Process:**

- **Copilot review unavailable since #157** ("quota limit"). Phases 0–3 had ~14
  defects found by review; Phases 4–8 had none found that way, and the
  difference is not that the code got better.
- **CI still does not run lint.** Every file touched in this session is clean;
  the rest of the tree is not.
