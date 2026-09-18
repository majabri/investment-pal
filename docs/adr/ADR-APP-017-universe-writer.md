# ADR-APP-017 — Who writes the investment universe

- **Status:** Accepted (2026-09-18, Amir Jabri — decided in session, recorded by Claude Code)
- **Date:** 2026-09-18
- **Deciders:** Amir Jabri
- **Money-adjacent:** No — a list of candidate symbols with scores and a tier. It sizes nothing and places nothing.

## Context

`investment_universe` has every §9.2 dimension and a tier column, and nothing
in the app writes it (UNIV-001). `/opportunities` therefore excludes held
names from an empty list. `AI_WRITABLE_TABLES` deliberately excludes the table:
the Committee may write `decisions` and `journal_entries` only.

## Decision

**Import**, with manual edits allowed. The owner pastes or uploads a list
(symbol, tier, and any of the twelve dimension scores, blank allowed); the app
validates at the boundary and upserts on `(user_id, symbol)`. Rows can be
edited or removed by hand on the same screen. **The AI boundary does not
change**: the Committee reads the universe and may recommend against it, but
does not write it.

## Options considered

1. **Manual entry only** — honest but slow for a hundred names.
2. **Import with manual edits** — fast to populate, the owner remains the
   author, boundary intact. **Chosen.**
3. **AI-scored under the boundary** — widens `AI_WRITABLE_TABLES` to a table
   that then feeds the AI's own recommendations. Rejected for now; may be
   revisited as its own ADR once the ranking (§9.2) exists.

## Consequences

- An import parser (`lib/universeImport.ts`) with the same shape as the CSV
  positions import: parse, validate, count what cannot be read, preview,
  then one write. `import_batches` records it with `source = 'imported'`.
- Ranking over the twelve dimensions and the rerank-on-sale trigger (BR-004)
  are unblocked but not built here.
