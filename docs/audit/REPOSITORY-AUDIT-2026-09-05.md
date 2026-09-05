# Repository audit — user-specific assumptions

**Rule 36.** *"Sweep source, migrations, server functions, prompt templates,
constants, environment config, tests, seed data, UI copy, logging, API
payloads, hooks, utilities. Classify every occurrence of personal or
user-specific assumption as: REMOVE / MOVE TO USER DATA / MOVE TO ACCOUNT
CONFIG / MOVE TO STRATEGY CONFIG / MOVE TO BROKER ADAPTER / REPLACE WITH
SYNTHETIC / LEGITIMATE GENERIC COPY. Produce a report demonstrating the
application does not depend on any one user's profile."*

**Swept:** `2026-09-05`, at `main` after Phase 7.
**Method:** case-insensitive search across `src/`, `supabase/`, `docs/` for
personal names, a broker name, hardcoded tickers, hardcoded money figures,
dates, and thresholds; then a read of every hit in context. Comments were read
but classified separately from code and copy, because a comment that documents
a broker's format is not the same thing as an application that assumes it.

---

## 1. Summary

| Class | Count | Status |
|---|---|---|
| REMOVE | 9 | done |
| MOVE TO USER DATA | 4 | done — `household_members` |
| MOVE TO ACCOUNT CONFIG | 6 | done — `accounts.*` |
| MOVE TO STRATEGY CONFIG | 5 | done — `strategies`, `strategy_symbols` |
| MOVE TO BROKER ADAPTER | 21 | done — copy neutralised; adapter keeps the format knowledge |
| REPLACE WITH SYNTHETIC | 3 | done |
| LEGITIMATE GENERIC COPY | 12 | retained, argued below |
| **NOT RESOLVED** | **2** | **listed in §7 — both are the owner's call** |

**The application no longer depends on any one user's profile in its source.**
Two things outside the source still do, and neither is a code change: the git
history, and the pending migrations. Both are in §7.

---

## 2. REMOVE

Data that had no home and no successor.

| Where | What | Why removed |
|---|---|---|
| `src/lib/data/kidsSeed.ts` | three children's names, three brokerage account numbers, ~45 hand-copied positions | Mock data in application code, and personal data about minors. Rendered as a fallback whenever no accounts were imported, labelled "seeded 2026-07-21" — a second user saw somebody else's children and somebody else's positions. |
| `familyPolicy.scoreWeights` | five weights | Read by nothing. A weighting nobody applies is a leftover, not configuration. |
| `familyPolicy.version` | `"1.0"` | A version number on a policy the app no longer holds names nothing. |
| `/kids` parity footer | "TSLA (~15% each) sits outside the approved list — standing committee agenda item" | One household's committee agenda, rendered to every user as if it were theirs. |
| `prompt-center` earnings lookup | six tickers appended to every user's holdings | One household's watchlist. Missed by the Phase 4 sweep because they were an **argument to a fetch** rather than a named constant. |
| `PortfolioCsvImport` | "Overwrite entire portfolio" switch | Deleted every holding the user had, including accounts the import was not mapping. Its OFF description is now simply what happens. |
| Prompt mandate | "Ignore all other **Fidelity** accounts" | Asserted to a model that the user banks at one named broker. |
| `prompts.ts` | `${ctx.ipsPositionCapPct ?? 30}` | A fallback that asserted a 30% limit as HARD GOVERNANCE when the caller supplied nothing. |
| `/kids` subtitle | "Family Investment OS v1.0 · $100/child every other Thursday" | One household's cadence, in copy and in code, disagreeing with each other (14 days vs "every other Thursday"). |

## 3. MOVE TO USER DATA — `household_members`

| Where | What |
|---|---|
| `familyPolicy.children` | three first names |
| `familyPolicy.children[].birthDate` | three birth dates |
| `accountGroups.ts` | first-name matching to classify accounts |
| `/kids` card titles | ages derived from the compiled-in dates |

**No rows are provisioned.** Rule 22: household is optional and no dependant is
assumed. `/kids` shows an empty state naming the fix.

## 4. MOVE TO ACCOUNT CONFIG — `accounts.*`

| Where | What | Column |
|---|---|---|
| `familyPolicy.targetPerChild` | `200_000` | `target_value` |
| `familyPolicy.targetDate` | `"2036-07-01"` | `target_date` |
| `familyPolicy.familyTarget` | `600_000` | derived — `combinedTarget()` |
| `familyPolicy.contribution` | `$100 / 14d / anchor` | `contribution_*` |
| account classification | name matching | `account_type` + `account_type_source` |
| broker | `NOT NULL DEFAULT 'Fidelity'` | `broker`, no default |

All NULL for every existing row. Nothing is backfilled.

## 5. MOVE TO STRATEGY CONFIG — `strategies`, `strategy_symbols`

| Where | What |
|---|---|
| `familyPolicy.core` | 8 tickers |
| `familyPolicy.supporting` | 5 tickers |
| `familyPolicy.preferredFuture` | 10 tickers |
| `familyPolicy.speculative` | 1 ticker + a 5% cap |
| `familyPolicy.parityRule` | a sentence written for one committee |

`familyPolicy.ts` is now two parameterised functions and is renamed
`objectiveMath.ts`.

## 6. MOVE TO BROKER ADAPTER

Twenty-one occurrences of one broker's name. The **format knowledge**
legitimately belongs to `src/lib/adapters/fidelity.ts`, `balanceImport.ts` and
`csvImport.ts` — those files parse that broker's output and their comments say
so, which is documentation rather than assumption.

What was **not** legitimate was user-facing copy telling every user which
broker they use:

- "Copy the balances block from **Fidelity**" → "from your broker"
- "From **Fidelity** → Balances → Cash & Credits" → "From your broker's balances page"
- "Owed to **Fidelity**" → "Owed to your broker"
- "paste **Fidelity**'s Positions CSV export" → "your broker's"
- "never connects to your **Fidelity** login" → "never connects to your broker"
- "accrued this month, per **Fidelity**" → "per your broker"
- "import from **Fidelity** in Settings" → "from your broker"
- "your **Fidelity** fill may differ" → "your broker's fill may differ"
- "**Fidelity** Crypto® accounts" → "Crypto accounts"
- `placeholder="Fidelity"` → `placeholder="Your broker"`
- "Your current **Fidelity** margin rate" → "Your current margin rate, from your broker"

…and eleven more of the same shape.

## 7. NOT RESOLVED — both are the owner's call

**1. Git history.** Everything the P0 remediation removed is still reachable in
the repository's history: real balances, the margin rate, the children's names
and birth dates, and the account numbers. Removing it means
`git filter-repo` and a force-push, which §5 of the P0 brief explicitly
reserves for Amir and which the repo's own rules forbid an agent from doing
(Lovable syncs from the branch). **Not attempted, by design.**

**2. Fifteen pending migrations.** Every schema change from Phases 1–6 is
written and none is applied. Until they are:

- the app cannot express most of what this audit moved into data;
- **the Portfolio CSV import will fail**, because the client no longer contains
  the old unsafe path — it calls `import_account_positions`, which does not
  exist in the database yet. That is deliberate: failing loudly beats silently
  doing the thing that dropped every thesis.

---

## 8. LEGITIMATE GENERIC COPY — retained, with the argument

| Where | What | Why it stays |
|---|---|---|
| `prompts.ts` | "Think like: BlackRock, Berkshire Hathaway, … Fidelity Active Management, …" | Named firms as a **style reference** for a model. Not a claim about the user's broker, and replacing them with "think like some large institutions" makes the prompt worse. |
| `brokerage.ts` | `name = "Fidelity (CSV export)"` | The adapter's own display name. It IS that adapter. |
| `adapters/fidelity.ts` | field-name knowledge throughout | The whole point of the adapter layer. Rule 3 asks that this live in exactly one file. |
| `balanceImport.ts`, `csvImport.ts` comments | "Fidelity prints it as a negative", "Fidelity's Type column is the account registration" | Documentation of a format the parser reads. Deleting it would make the parser unmaintainable and would not make the app more general. |
| `accountTotals.ts` | `/** Fidelity's "margin market value" */` | Names which broker's term a canonical concept corresponds to. Useful, and it does not assume. |
| `ACCOUNT_TYPES` | `brokerage / ira / roth_ira / 401k / hsa / trust / 529 / crypto / cash / other` | US account registrations. Broad, and the vocabulary any US user needs. |
| `IPS_LITE_DEFAULTS` | 30% / 25% | Signed-off defaults (ADR-APP-004), and now **labelled as defaults** with `caps_source` (rule 15). Legitimate as a default; it was the masquerade that was not. |
| Reg-T 50% floor | dashboard breach line | A regulatory constraint, now labelled as one rather than shown beside self-imposed caps in identical words (rule 21). |
| `DEFAULT_TOLERANCE` | $0.01 noise / $100 or 0.05% material | Statements about what counts as money and what counts as a proportion. Tested at $500 and at $5m (rule 31). |
| `DEFAULT_STALENESS` | 1h quote / 4h delayed / 7d snapshot / 30d typed | Properties of the data's kind, not of any portfolio. |
| `PRICE_DECIMALS` | 2 / 4 / 5 / 8 by instrument | Conventions of the instruments (rule 33). |
| `LOT_QUANTITY_EPSILON` | 1e-4 **shares** | A statement about share counts, not about size. |

## 9. REPLACE WITH SYNTHETIC

| Where | What |
|---|---|
| `accountTotals.ts` header | "Verified against a Fidelity balances page" → against the **synthetic** block in `balanceImport.test.ts` |
| every test fixture touching balances | real figures → round invented ones |
| `syntheticRegression.test.ts` | the brief's own $500 / $50k / $5m triple, all synthetic |

## 10. Standing guards

The audit is a snapshot; these are what keep it true.

| Guard | Asserts |
|---|---|
| `personalData.test.ts` | no real name or balance figure reappears anywhere in `src/` or `supabase/`; a brokerage-account-number **shape** never appears |
| `household.test.ts` | no module under `src/lib` carries an array of people or a literal birth date |
| `accountObjective.test.ts` | no module carries a compiled-in target, horizon or contribution plan |
| `strategy.test.ts` | no module carries a ticker list; the accounting core imports no strategy configuration |
| `promptMandate.test.ts` | the rendered prompts contain no personal name; the objective has one home per scope |
| `aiBoundary.test.ts` | AI output can never write a financial field |
| `precision.test.ts` | no engine module rounds |
| `secondUser.test.ts` | two unrelated synthetic profiles get their own answers from the same code (rule 37) |

**Every one of these is paired with a negative control** asserting the guard
would actually fire — because a guard that matches nothing passes forever, and
this program has caught nine instances of a guard being coarser or wronger than
the fault it named.
