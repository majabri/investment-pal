# Investment Pal — Copilot Agent Instructions

Read `AGENTS.md` and `CLAUDE.md` before making changes. They are the source of
truth when this document is less specific.

## Working agreement

- Work in small, reviewable pull requests that deliver one capability.
- Treat `main` as the source of truth. Do not force-push, amend, rebase, or
  squash existing shared history.
- Use Bun. Install with `bun install --frozen-lockfile`; do not add a
  `package-lock.json`.
- Before requesting review, run the relevant checks. At minimum run
  `bun run typecheck`, `bun run test:typecheck`, `bun test`, and `bun run build`
  when those commands apply to the change.
- Do not commit generated build artifacts, local `.env` files, secrets, API
  keys, or service-role credentials. Use `.env.example` only for variable
  names and safe placeholders.

## Safety-critical application rules

- This application is advisory only: never add direct broker execution, order
  submission, or automatic trading.
- Keep decision confidence separate from outcome probability.
- Do not change money-adjacent business rules, thresholds, sizing, allocation,
  margin, tax, or recommendation logic without explicit owner sign-off and
  focused tests.
- Server functions that call AI or external market/news/calendar providers must
  require authenticated users, validate and bound input, and use the shared
  rate-limit protection where applicable.
- Supabase changes must be additive migrations with row-level security and
  least-privilege grants. Never expose service-role keys to client code.

## Code conventions

- TypeScript is strict. Prefer small, typed, testable functions and behavior-
  focused tests under `src/lib/__tests__` for pure decision logic.
- Preserve existing UX and route conventions. Do not modify generated route
  files by hand.
- Record consequential architecture choices in `docs/adr/` and unresolved
  product choices in `docs/open-decisions/`.

## Pull request standard

- Explain the user impact, risk, migration/deployment order, and exact
  validation performed.
- Call out anything that needs human approval rather than silently making a
  financial or irreversible product decision.
