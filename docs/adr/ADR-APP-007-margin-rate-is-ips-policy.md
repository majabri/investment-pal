# ADR-APP-007 — The margin rate is IPS policy, and unset suppresses

- **Status:** Accepted
- **Date:** 2026-09-03
- **Deciders:** Amir Jabri (2026-09-02 master instruction), Claude Code (mechanism)
- **Money-adjacent:** Yes — and resolved without anyone choosing a number. See below.

## Context

The margin rate was a constant in two independent places:

- `src/routes/_authenticated/index.tsx:269` — `(marginUsed * 0.11825) / 365`, a
  **computation** producing a dollar figure on the dashboard
- `src/components/app/MarginCard.tsx:70` — the string `"Owed to Fidelity at 11.825% APR"`

They agreed. **Nothing kept them agreeing.** Change one and the app would confidently
display a rate it was not using. Eight further copies sat in the committee prompt
templates, two of which said 12.075% rather than 11.825%.

Amir confirmed on 2026-09-03 that the rate has changed since, so every one of those
constants was stale.

## The problem with a constant, beyond staleness

Fidelity margin rates are **tiered by debit balance and float with the base rate**. A
hardcoded number is therefore wrong in two independent ways over time: it drifts as
rates move, and it is wrong the moment the balance crosses a tier — even if nobody
changed anything.

The dashboard site sat directly beside the C3 25% margin cap, so an understated rate
made leverage look cheaper next to the control meant to limit it.

`ips.schema.json` in the certified repository defines `margin_policy` as a first-class
IPS object. The rate is **policy, not app config**. Here the IPS is `public.ips_lite`,
which held `position_cap_pct` and `margin_cap_pct` and no rate at all.

## Decision

**The rate lives in `ips_lite` and is entered through Settings. No rate exists in code.**

This is what makes a money-adjacent change safe to build autonomously: the mechanism is
built without anyone choosing a number, so there is no value to sign off. Amir supplies
it through the app.

```sql
ALTER TABLE public.ips_lite
  ADD COLUMN IF NOT EXISTS margin_rate_annual_pct  NUMERIC,          -- no DEFAULT
  ADD COLUMN IF NOT EXISTS margin_rate_as_of       DATE,             -- no DEFAULT
  ADD COLUMN IF NOT EXISTS margin_rate_is_floating BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS margin_rate_stale_days  INTEGER NOT NULL DEFAULT 30;
```

### Unset suppresses. It never zeroes.

`dailyMarginInterest()` returns **`null`** when the rate is unset, and callers render
"margin rate not set". It does not return 0, does not fall back to a previous value,
and does not use a plausible default.

This is the single most important rule in this ADR. **A missing rate that silently
computes as zero makes leverage look free** — and it would do so on the same strip as
the margin cap, which is the worst possible place to understate the cost of borrowing.

The same rule reaches the committee: with no rate, the prompt says `NOT SET` and
instructs the model not to assume, estimate or carry one forward. Silently dropping the
concept would be worse than a stale number — a model reasoning about leverage with no
rate supplies a plausible one of its own, which is the unsourced assertion AIOS §27
prohibits.

### `margin_rate_stale_days` defaults to 30, and that is not a money value

It is a **display threshold**: how old the as-of date may get before the supervision
strip flags it in amber. Changing it changes when a warning appears and nothing else.
It is editable in Settings.

The amber is deliberate — an ageing rate is a prompt to re-check, not a policy breach.
Red stays reserved for constitution breaches.

## Consequences

- Ten rate constants are gone. `marginCost.test.ts` sweeps all production source for
  both spellings (`11.825` **and** `0.11825`) after stripping comments; the decimal
  form is why the computing site went unnoticed while a search for `11.825` came back
  clean.
- A test asserts the migration contains no `DEFAULT` for the rate. Verified by
  injecting `DEFAULT 11.825` — the test fails.
- A test asserts an unset rate yields `null`, not `0`. Verified by changing the guard
  to `return 0` — the test fails.
- **The rate ships unset.** Until Amir enters it, the dashboard shows no interest cost
  and the committee is told the rate is unknown. That is the intended state, not a
  regression: an honest gap beats a confident wrong number.
- `MarginCard` and the dashboard now read the same source, so they cannot disagree.
