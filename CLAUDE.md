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
- Committee (in-app since #226): `src/lib/chatServer.ts` (provider: `OPENAI_API_KEY`
  or `LOVABLE_API_KEY`, set in the hosting environment, never in code),
  `committeeContract.ts` (schema, `PROMPT_VERSION`, `parseCommitteeJson`),
  `committeeDecisions.ts` (`DecisionStamp`, `decisionInserts`),
  `src/hooks/useCommittee.ts` (the one write, `assertAiWritable` per row),
  `src/components/app/CommitteeChat.tsx`. There is no copy/paste path to an
  outside AI any more, and Amir does not want one back.
- Honesty helpers: `calendarCoverage.ts` (quiet ≠ dead), `newsRelevance.ts`
  (symbols from the caller, never a literal), `goalAgreement.ts` (screen vs
  record), `src/hooks/useReconciliation.ts` (one comparison, panel and alert).
- Ledger write side (#230): `trancheDraft.ts` (pinned to `tranches_bounds` by
  a test that reads the migration), `tranchesView.ts`, `TranchesPanel.tsx`.
- Quotes (#231): `quoteProvenance.ts` — §B.2 shape, freshness against the
  market clock; the brief's `quoteProvenanceLine`; the refresh button writes
  the quote's own time to `last_price_at`.
- Daily closes (#243): `dailyClose.ts` — a quote is a close only outside
  the regular session, dated by the exchange's calendar (`exchangeTimezone`
  on the quote); skips carry reasons; `closeCoverage` shows gaps as gaps.
  `PriceHistoryRecorder` writes only what it returns. Still client-triggered.
- **Schema tests (#233, #244):** `src/lib/__tests__/schema/replay.ts` replays every
  migration into PGlite (Postgres in WebAssembly, devDependency) with
  `auth.uid()`, the roles and Supabase's default privileges stubbed;
  `eventsAudit.test.ts` is the model for testing a migration before Lovable
  applies it; `importRpc.test.ts` (#246) calls `import_account_positions`
  as the client role — atomic rollback, idempotent re-import, account
  scope, narrative columns kept; `rls.test.ts` has a second user try every table under
  `actAs("authenticated", …)` — the superuser bypasses RLS, so a schema test
  that never switches role proves nothing about it. Lovable's five duplicate
  files are not idempotent and are pinned by name there. **Write the schema
  test (including the RLS sweep's seed row) in the same PR as the migration.**
- Universe write side (#257, ADR-APP-017): `universeImport.ts` (parser is
  the boundary: skip with reason, never clamp or default; first duplicate
  wins), `hooks/useUniverseImport.ts` (staged batch → upsert → committed),
  `UniverseImportPanel` on `/opportunities`. The Committee never writes it.
- Fills against holdings (#256, ADR-APP-016): `fillHoldingReconciliation.ts`
  (window = (previous import end, this import end]; excluded and outside
  fills are counted), `hooks/useFillHoldingReconciliation.ts`,
  `FillHoldingPanel` on `/portfolio`. Compares; never applies.
- Goal probability (#259, #261): `probabilityOfReachingTarget` is `null`
  when it has nothing to project from or over; `fmtProbability` prints
  bounds, not `0%`/`100%`; `PROBABILITY_BASIS` names what it is a
  probability of (OD-004: current value only) on both screens and in the brief.
- Governing goal (#267, GOAL-001): `governingGoal.ts` — the latest valid
  `goal_versions` row governs the dashboard and the brief; the `goals` row
  only with a carried reason; `/goals` previews what is typed. Never silent.
- Universe read side (#268): `universeView.ts` `rankUniverse` (`rank-v1`:
  tier, conviction desc, unscored last never zero), `UniverseRankPanel`.
- Fill mismatch alert (#269): `countFillMismatches` in `alerts.ts`; the
  dashboard feeds the scoped account's orders + fills; NULL = not evaluated.
- Event consumers (#262, ADR-APP-018): `event_consumers` + the two RPCs are
  the ONE write path to a cursor and to `consumed_at`; a consumer reads
  `id > cursor`, handles, advances. Register at the present; never backwards;
  never past the last event; `consumed_at` = every consumer has passed.
  Schema test `eventConsumers.test.ts`. **First consumer (#265):**
  `lib/eventConsumers.ts` (plan, pure), `hooks/useEventConsumer.ts`
  (register → poll → invalidate → advance via RPC), `EventConsumerRunner`
  in `AppShell`; the cursor line on `/settings`. GoalChanged → `["goal"]`,
  `["goal_versions"]`. Other consumers register their own name.
- Alerts (#210 rules, #238 schema, #248 record): `alerts.ts` decides what
  wants attention; `alertRecord.ts` is the identity (fingerprint = type +
  message with figures blanked), the write gate (`recordDecision`), the row
  boundary and the sentences; `hooks/useAlertRecord.ts` reads and writes
  (`raise_alerts`, the one UPDATE for "seen"); `AlertRecorder` sends the set
  once per change and only when the evaluation is complete; `AlertsPanel`
  shows standing and seen — acknowledged is shown, never hidden.
- Events and audit (#233, applied by Lovable 2026-09-17): `domain_events`
  (fourteen §19.1 names, outbox; read by `activityView.ts` / `ActivityPanel`
  since #241; no consumer yet), `audit_log`, one trigger
  `record_change()` on ten tables (the tenth, `alerts`, since 2026-09-18); `import_batches` (written by the CSV
  import since #236, `lib/importBatch.ts`); `orders.decision_id`/`tranche_id`;
  order states `untriggered`/`superseded`.
- Lovable applies migrations through Drizzle now: `drizzle.config.ts`,
  `drizzle/migrations/` (a copy of each applied file plus a journal). Leave
  it alone; `supabase/migrations/` stays the source of truth and the only
  thing the PGlite replay reads. Its installs write lockfile entries that
  point at Lovable's private npm cache, which the sandbox proxy cannot reach;
  normalise them to the empty-URL form (#235) when the frozen install fails
  here with a 403 — CI is unaffected either way.
- The Blueprint-to-Code Gap Matrix (2026-09-16, 104 rows, private artifact):
  <https://claude.ai/artifact/RDpasbToaZPehkbVzmJF4D>. Its Phase 1 list is
  the backlog; the session log says which rows have landed since.

## Current state (2026-09-18)

**HEAD on `main`:** `77a67f9` (#269, the fill-mismatch alert). Suite
**1926 pass / 0 fail** (73 of them the schema layer: replay, events/audit,
alerts, RLS, import RPC, grants, backfill, consumers); tsc and
`test:typecheck` clean; boot 200 on `/auth`, `/`, `/portfolio`, `/decisions`,
`/goals`, `/prompt-center`, `/opportunities`, `/settings`.

**The execution ledger is fully on screen** (#212 → #216, applied by Lovable
2026-09-12) **and written from it** (#230 tranches; #216 fills).

**Since the gap matrix (#224 → #250):** calendar coverage · news relevance
from the caller's symbols · **the Committee runs in the app and records its
own decisions** with all four versions and the readiness verdict stamped ·
the reconciliation alert · goal-on-screen vs goal-on-record · tranche
open/close · quote provenance to §B.2 · the gate names the missing input
and every meeting states its purpose (live feedback, #232) · the events /
audit / import-batch / order-links migration with the first schema test,
**applied in production by Lovable** · the lockfile back on the default
registry · every CSV import recorded as a batch with its checksum · the
alerts migration (#238, awaiting Lovable) · a tranche names the decision
that opened it (#240) · the event record on screen at `/settings` (#241,
the first reader of `domain_events`/`audit_log`) · **the daily close is a
close** (#243: session-ended quotes only, dated by the exchange; a missed
day is a visible gap) · **RLS exercised** (#244: a second user tries every
table under the client role in PGlite; the matrix's "proven by reasoning"
risk is closed for RLS) · **the import RPC run for real** (#246: §26.2
tests 6 and 7 — nothing in the matrix's "proven by reasoning" item is by
reasoning any more) · **the alert record on the dashboard** (#248: standing,
seen, one writer; Lovable applied the schema 2026-09-18) · **React 19.3
with its pair** (#249; Dependabot #221 had bumped `react` alone and was
closed as superseded) · **the client roles' grants on `domain_events` and
`audit_log` narrowed** (#250, after the production catalog showed ALL;
applied by Lovable 2026-09-18).
Dependabot #219/#220/#222/#223 merged.

**The decided work, built (#254 → #259, 2026-09-18 night):** the seven
verbs with legacy values marked (#254) · the `decisions.account_id`
backfill migration + schema test (#255, **awaiting Lovable**) · fills
against holdings as a read-only reconciliation view on `/portfolio`
(#256) · **the universe import** on `/opportunities` — the owner writes
the universe, the Committee reads it (#257) · the unrendered debit ÷ gross
ratio removed (#258) · **goal probability: unknown is `null`, small is a
bound, never `0%`** (#259; the model itself is OD-004).

**Standing rules learnt the hard way:**
- Unknown ≠ zero ≠ empty ≠ error ≠ stale. `not_recorded` is its own state.
- A library with no caller is inert code (PERF-001, UNIV-001, `useOrders`
  until #215, `getPricesFn` until #231). Migration first, wiring second;
  read before write.
- The generated types are honest for columns typed `string` in the domain
  and lie for narrow unions — validate at the boundary and **count** what
  cannot be read; never drop, never default.
- Presentation logic lives in `lib/*View.ts`, not components. Importing even
  a `type` from `useAppData.ts` into a lib pulls the browser client into
  `test:typecheck`: declare a structural type instead (`PolicyLike`).
- `orders.filled_quantity` is the broker's claim; fills are the evidence;
  `reconcileFills` is where they meet. Never write Σ fills back onto the order.
- A file that names model output (`aiBoundary.test.ts` markers) may write
  only `decisions`/`journal_entries`; put such a hook in its own file.
- The owner's name, figures, and the SHAPE of a ticker list are all
  forbidden in `src` (`personalData.test.ts`), comments included.
- A boundary that carries a status and drops the reason behind it produces
  a screen that says "an input is missing" and cannot say which (#232).
  Carry the reasons.
- A migration is testable before Lovable sees it: replay into PGlite,
  apply the candidate twice, exercise the triggers, fault-inject the SQL.
  Write the schema test in the same PR as the migration.
- A record that spans a write opens BEFORE it (`staged`) and closes after
  (`committed` / `failed`), so an interrupted write leaves a true row.
- In the sandbox, `pkill -f "vite dev"` kills the shell that runs it. Kill
  by PID. Two commits were silently skipped that way before it was noticed.
- Verify a vendor's account of what it did against git before building on
  it; Lovable's apply also added Drizzle and rewrote 91 lockfile entries.
- GitHub sometimes starts no CI run for a PR's push; check the branch's
  workflow runs, and dispatch `ci.yml` on the branch by hand when there are
  none (it counts as the PR's check on that SHA). Never an empty commit.
- Two PRs cut from the same `main` that both add an import to
  `useAppData.ts` will conflict on the line; merge `main` in, keep both.
- The superuser bypasses RLS. A schema test that never `SET ROLE`s proves
  nothing about a policy; and under Supabase's default privileges a GRANT
  narrows nothing — model both (`replay.ts`) or the test passes for the
  wrong reason. Every new table needs a seed row in `rls.test.ts`.
  **Confirmed in production 2026-09-18:** every table gets ALL for `anon`
  and `authenticated` at creation. A migration that wants a narrower
  client surface must REVOKE ALL first, then GRANT (#250).
- A "close" is a price the provider's clock says the session ended on,
  dated by the exchange's calendar. The user's local date and an intraday
  print are both wrong in a way the row cannot show afterwards.
- **Always check whether the work was done already** before doing it.

**Decided by Amir 2026-09-18 (#253, his merge):** ADR-009–014 Accepted;
OD-003 = net equity (ADR-004 C2 amended); ORD-001 = (a) reconciliation view
(ADR-016); ADR-008 Amendment 1 = the blueprint's seven verbs; universe
writer = import (ADR-017); `decisions.account_id` backfill, one-account
users only (ADR-019). **Still open, Amir's:** OD-001 Amendment 2 (see
*Merge authority*); ADR-APP-015 (navigation, by his instruction); ADR-APP-018
(Accepted, merged by Amir 22:30Z); replacing §26.3 in the Drive
blueprint; 86 merged remote branches the git proxy will not let Claude Code
delete; the D-20 catalog query for the three new tables (the `domain_events`
privilege question is answered, fixed and **confirmed in production**:
#250, applied 2026-09-18, ACL re-read the same day).

**Lovable applied, 2026-09-18, all verified against git:** the alerts
schema, the `decisions.account_id` backfill (0 rows moved — every decision
already had an account) and `20260918210000_event_consumers.sql` (19:15Z).
**Everything decided on 2026-09-18 is built and wired** (#254 → #265):
ADR-018 = per-consumer cursor (#262 schema, #265 the first consumer,
GoalChanged → the goal caches); OD-004 = label it (#261). **Nothing awaits
Lovable.** **Amir's merge:** #263 (ADR-018 Accepted; reported merged, still
open on GitHub). **UNVERIFIED live:** the universe paste box on
`/opportunities`, the Goal outlook's probability line, the consumer cursor
on `/settings` — Amir published 19:15Z and has not reported back.
**Supabase-side:** the daily-close schedule (the recorder writes only true
closes since #243; the schedule is what is missing).
