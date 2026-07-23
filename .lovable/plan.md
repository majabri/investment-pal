# Amir Investment Companion — Build Plan

## Scope (Version 1)

A single-user, dark-mode-first web app that acts as your daily decision-support command center. Everything is optimized for the morning workflow: refresh → brief → generate ChatGPT prompt → record decisions → EOD review → journal.

**Not in v1:** multi-user, trading execution, kids' accounts, Monte Carlo, tax optimization, scenario analysis (architecture will allow them later).

## Stack note (important)

Your spec says Next.js. The Lovable platform builds on **TanStack Start (React 19 + TypeScript + Vite + Tailwind)** with **Lovable Cloud (Supabase under the hood)** for auth + database. This gives you the same capabilities (SSR, server functions, Supabase auth/DB, Recharts, dark mode, responsive). If you require literal Next.js, this template can't deliver it — please confirm you're OK with TanStack Start before I implement.

## Information architecture

Routes:
- `/` Dashboard (Morning Brief) — the home
- `/portfolio` Holdings, allocation, cash/margin, per-position thesis
- `/prompt-center` Morning Review + End-of-Day Review prompt builders
- `/journal` Searchable history (reviews, trades, AI summaries, notes, lessons)
- `/goals` Target value, date, contributions, risk/margin preferences
- `/settings` Fidelity connection, refresh preferences, profile
- `/auth` Sign in (email/password, single user gated by allowlist)

Shared shell: left nav, top bar with "Last sync" + manual refresh, command palette (⌘K).

## Dashboard (fits one screen, decision-first)

Blocks, in priority order:
1. Greeting + Portfolio Value + Today's P/L (absolute + %)
2. Goal Progress bar: current → target by date, Required CAGR, Current Probability, Margin Status
3. Last Portfolio Sync + Refresh button
4. Today's Priorities (earnings tomorrow, elevated margin, macro events, concentration warnings)
5. Recommended Actions grouped by Review / Buy Candidate / Hold / Reduce / Watch
6. Primary CTA: **Start Morning Review** (largest button, routes to Prompt Center pre-filled)

## Portfolio

- Holdings table: symbol, qty, cost basis, current value, gain/loss $/%, allocation %, sector
- Cash, Margin used, Buying Power cards
- Sector allocation donut (Recharts), Performance history line chart
- Position detail drawer: Original Thesis, Current Thesis, Why I Own It, Last AI Review, My Notes, Last Reviewed (all editable)

## Fidelity integration (brokerage service layer)

Abstraction `BrokerageService` with two implementations:
- `ManualImportAdapter` (v1 default): CSV / paste-in importer for holdings, cash, margin, transactions, dividends
- `FidelityDirectAdapter` (stub interface, disabled): ready for a future direct/read-only connection

Sync status card everywhere: Connection Status, Last Sync, Manual Refresh. **Never** trading.

## Prompt Center

Two builders (Morning, End-of-Day) sharing the same engine:
- Checklist of inputs: Portfolio snapshot, Market snapshot, News, Economic calendar, Earnings calendar, Goal progress
- Live prompt preview (markdown)
- Buttons: Copy Prompt, Open ChatGPT (new tab), Save AI Summary (pastes response back, stored in Journal)

Data sources for context (v1): portfolio DB + user-entered notes + editable calendar entries. (Live market/news/earnings feeds deferred to v1.1 — placeholders + manual entry now, adapter interface ready.)

## Journal

Permanent history: Morning Reviews, EOD Reviews, Trades, AI Summaries, Notes, Lessons, Decisions. Full-text search + filter by type/date/ticker. Each entry timestamped and immutable (edits create a new version).

## Goals

Editable: Target Value, Target Date, Starting Value, Optional Contributions (recurring), Risk Preference, Margin Preference. Auto-computed: Progress %, Required CAGR, Weekly/Monthly growth required, Estimated Completion Date, Probability of Success (log-normal model using assumed vol from risk preference). Recalculates on every change. Shows 2–3 suggestions to improve probability.

## Data model (Lovable Cloud / Supabase)

Tables (all RLS-scoped to owner, single-user allowlist):
- `profiles`, `goals`, `holdings`, `positions_meta` (thesis/notes/last_reviewed), `accounts` (cash/margin/buying_power), `transactions`, `dividends`, `watchlist`, `target_allocations`, `priorities`, `recommended_actions`, `journal_entries` (type, body, tickers[], ai_summary, tags), `prompt_runs`, `sync_log`.

System-generated vs user-entered flagged via `source` column ('system' | 'user') and rendered with distinct styling.

## Architecture

```
src/
  routes/           TanStack routes (pages)
  components/       UI (shadcn + custom)
  features/
    dashboard/  portfolio/  prompt-center/  journal/  goals/
  services/
    brokerage/    ManualImportAdapter, FidelityDirectAdapter (stub)
    market/       MarketDataAdapter (stub + manual)
    probability/  CAGR + probability model
    prompts/      Morning/EOD prompt templates
  hooks/  lib/  types/  utils/
  integrations/supabase/
```

Every data card component takes `{ lastUpdated, onRefresh, status }` props (uniform freshness UX).

## Design

Dark-mode first, Apple-desktop feel: dense but calm typography, semantic color tokens in `src/styles.css` (no hardcoded colors), generous negative space, one primary action per screen, subtle motion. Recharts themed to tokens.

## Auth

Lovable Cloud email/password. Single-user allowlist enforced by an `allowed_emails` table + RLS — signups outside the allowlist are rejected. (Google sign-in optional; say the word.)

## Build order

1. Enable Lovable Cloud, schema + RLS + allowlist auth
2. App shell, routing, dark theme, nav
3. Goals module + probability engine
4. Manual portfolio import + Portfolio page
5. Dashboard (Morning Brief) wired to real data
6. Prompt Center (Morning + EOD)
7. Journal with search
8. Settings + sync log + Fidelity adapter stub
9. Polish pass (empty states, keyboard shortcuts, ⌘K)

## Open questions before I build

1. Confirm TanStack Start is acceptable instead of literal Next.js.
2. For v1, is **manual import (CSV/paste)** from Fidelity fine, with a direct-connection adapter stubbed for later?
3. Live market/news/earnings: OK to start with **manual entry + placeholders** and add a real data provider (e.g. Finnhub/Polygon via your API key) in v1.1?
4. Any starting numbers you want pre-seeded (Amir-TOD starting value, contributions, risk preference)?
