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
- **Schema tests (#233):** `src/lib/__tests__/schema/replay.ts` replays every
  migration into PGlite (Postgres in WebAssembly, devDependency) with
  `auth.uid()` and the roles stubbed; `eventsAudit.test.ts` is the model for
  testing a migration before Lovable applies it. Lovable's five duplicate
  files are not idempotent and are pinned by name there. **Write the schema
  test in the same PR as the migration from now on.**
- Events and audit (#233, applied by Lovable 2026-09-17): `domain_events`
  (fourteen §19.1 names, outbox; no consumer yet), `audit_log`, one trigger
  `record_change()` on nine tables (ten with `alerts`, #238, once applied); `import_batches` (written by the CSV
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

## Current state (2026-09-17, evening)

**HEAD on `main`:** the merge of #238. Suite **1686 pass / 0 fail** (23 of
them the schema replay); tsc and `test:typecheck` clean; boot 200 on
`/auth`, `/`, `/portfolio`, `/decisions`, `/goals`, `/prompt-center`,
`/settings`.

**The execution ledger is fully on screen** (#212 → #216, applied by Lovable
2026-09-12) **and written from it** (#230 tranches; #216 fills).

**Since the gap matrix (#224 → #236):** calendar coverage · news relevance
from the caller's symbols · **the Committee runs in the app and records its
own decisions** with all four versions and the readiness verdict stamped ·
the reconciliation alert · goal-on-screen vs goal-on-record · tranche
open/close · quote provenance to §B.2 · the gate names the missing input
and every meeting states its purpose (live feedback, #232) · the events /
audit / import-batch / order-links migration with the first schema test,
**applied in production by Lovable** · the lockfile back on the default
registry · every CSV import recorded as a batch with its checksum.
Dependabot #219/#220/#222/#223 merged; **#221 (React 19.3) is red for a
real reason** — `react-dom` not bumped with `react` — and is Amir's call.

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
- **Always check whether the work was done already** before doing it.

**Open, all Amir's:** OD-001 Amendment 2 (see *Merge authority*); ADR-APP-009
–015 all `Proposed`; OD-003; ORD-001 a/b; the ADR-008 action vocabulary;
the universe writer; `decisions.account_id` backfill; replacing §26.3 in
the Drive blueprint; #221; pasting a balance block on Settings so the
reconciliation can run; 86 merged remote branches the git proxy will not
let Claude Code delete; the D-20 catalog query (now also for the three new
tables).

**Waiting on Lovable:** `20260917180000_alerts.sql` (#238; paste-ready line
in its body). **Then buildable:** the alerts panel wired to `raise_alerts`
and `acknowledged_at` (fingerprint = type + message with figures blanked;
acknowledged alerts shown as acknowledged, never hidden) · a first
`domain_events` consumer · the daily-close job (Supabase-side).
