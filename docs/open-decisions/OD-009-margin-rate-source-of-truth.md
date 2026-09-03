# OD-009 — The margin rate has no single source of truth (ten sites, two values, one of them arithmetic)

- **Status:** Open
- **Raised:** 2026-09-02
- **Area:** money movement

## Context

Handoff item 3 asks for `ADR-APP-007`, recording the margin rate. That ADR cannot be
written without Amir's values (OD-001: any threshold or rate is money-adjacent and needs
explicit line-item sign-off). This OD does not attempt to answer it. It records **what
the code actually does today**, so the decision can be made against evidence rather than
recollection.

The rate is not stored anywhere. It is a **constant repeated in ten places across three
files**, and the values are not all the same number. Nine are text; the tenth is
arithmetic on a live screen.

| # | Site | Value | Hedge | On a live screen? |
|---|---|---|---|---|
| 1 | `src/components/app/MarginCard.tsx:70` | 11.825% | — | **yes** |
| 2 | `src/lib/prompts.ts:1281` — `buildV6Prompt` rate note | 11.825% | "(updated)" | **yes** |
| 3 | `src/lib/prompts.ts:167` — Morning v4 template | 11.825% | "(unless updated)" | no |
| 4 | `src/lib/prompts.ts:346` — `buildMorningPrompt` | 11.825% | verified 2026-07-24 | no |
| 5 | `src/lib/prompts.ts:679` — Midday template | 11.825% | — | no |
| 6 | `src/lib/prompts.ts:871` — `buildUniversalPrompt` rate note | 11.825% | "(updated)" | no |
| 7 | `src/lib/prompts.ts:1044` — `buildV5Prompt` rate note | 11.825% | "(updated)" | no |
| 8 | `src/lib/prompts.ts:433` — **Weekly template** | **12.075%** | — | no |
| 9 | `src/lib/prompts.ts:701` — **Universal template** | **12.075%** | "unless updated" | no |
| 10 | `src/routes/_authenticated/index.tsx:269` — `dailyInterest` | **`0.11825`** | — | **yes — and it is arithmetic** |

### Site 10 is the one that matters most, and I missed it first time

```ts
const dailyInterest = (marginUsed * 0.11825) / 365;
```

The first nine sites are **text** — a label, or a sentence handed to the model.
Site 10 is **arithmetic**: it multiplies a real margin balance and puts the
result on the dashboard as a dollar figure. A wrong rate here is a wrong number
on screen, not a wrong sentence.

I did not find it in the first pass because I grepped for `11.825` and this site
writes the rate in decimal form as `0.11825`. Worth recording as a search
lesson: **a rate constant can be spelled at least two ways, and the arithmetic
one is the dangerous one.** Any future sweep must cover both forms.

## Which prompt builders emit which number

I did not infer this from reading the templates — I ran every builder and searched its
output for both numbers:

| Builder | Emits 11.825% | Emits 12.075% | Reachable from a route |
|---|---|---|---|
| `buildV6Prompt` | yes | no | **yes — the only one** |
| `buildV5Prompt` | yes | no | no |
| `buildMorningPrompt` | yes | no | no |
| `buildMiddayPrompt` | yes | no | no |
| `buildEODPrompt` | yes | no | no |
| `buildUniversalPrompt` | **yes** | **yes** | no |
| `buildWeeklyPrompt` | no | **yes** | no |

**No live prompt carries the 12.075% figure.** `prompt-center.tsx` is the only route that imports from
`@/lib/prompts`, and it imports exactly one builder — `buildV6Prompt`. `OS_V6_TEMPLATE`
contains no rate of its own; the only rate in the generated prompt is the appended note at
11.825%, matching what `MarginCard` shows. **No screen today shows or sends 12.075%.**
The 12.075%/11.825% *disagreement* is therefore not a live defect, and I am not reporting
it as one. That is a narrower claim than "the live path is clean": site 10 is live, is
arithmetic, and uses a figure Amir has now said is out of date.

**Two builders are one import away from being live, and they fail differently.**
Both are exported and covered by `promptMandate.test.ts`, so they read as supported API
rather than dead code; wiring a "Weekly" tab is the obvious next feature.

- `buildWeeklyPrompt` emits **12.075% and nothing else**. There is no rate note appended
  and no "unless updated" hedge, so the prompt asserts a borrowing cost 25 bps above the
  one the rest of the app uses, with nothing to correct it.
- `buildUniversalPrompt` emits **both numbers in the same prompt**. The template says
  12.075% "unless updated" and the appended note says "(updated): 11.825%", so the
  intended precedence is recoverable — but the committee is being handed two different
  borrowing costs and left to reconcile them.

**Every literal carries a stale verification date.** Five sites say "verified 2026-07-24"
— 40 days old today. Nothing in the app records when the rate was last confirmed, and
nothing degrades or warns when it ages. A committee prompt asserting a rate as current
fact, 40 days after anyone checked, is the kind of unsourced assertion AIOS §27 exists to
prevent.

**Which number is right is not mine to determine.** Both appear in prompts Amir supplied
verbatim, on different dates. 12.075% may be a superseded quote rather than an error.
Amir's answer on 2026-09-03 was **"neither — it has changed since"**, without supplying
the replacement, so all ten sites are now known to be stale and the correct figure and
its as-of date are still outstanding.

### A constant is the wrong shape here, not just the wrong number

Fidelity margin rates are **tiered by debit balance and float with the base rate**. A
hardcoded constant is therefore wrong in two independent ways over time: it drifts as
rates move, and it is wrong the moment the debit balance crosses a tier — even if
nobody changed anything. Site 10 sits beside the C3 25% margin cap, so an understated
rate biases the screen toward making leverage look cheaper than it is, right next to
the control meant to limit leverage.

This also settles *where* the value belongs, with evidence rather than preference.
`ips.schema.json` in the certified repository defines **`margin_policy` as a
first-class IPS property** — so the rate is IPS policy, not app config. Here the IPS is
`public.ips_lite`, which today holds `position_cap_pct` and `margin_cap_pct` and **no
rate at all**. That is the gap, and it is why `ips_lite` is the recommended home rather
than a new table.

## Options

1. **Answer item 3's four questions, then store the rate once.** Amir supplies the rate,
   its as-of date, whether it is fixed or floating, and what the app does when the value
   goes stale. It is stored in `ips_lite` (recommended over a new table — the mandate
   already lives in a row, and PR #97 established reading it from data), read by both
   `MarginCard`, the prompt builders and the `dailyInterest` computation, and all ten
   constants are deleted.
2. **Delete the two 12.075% literals now; defer storage.** A minimum-scope PR that makes
   the ten sites agree and removes the latent trap, leaving centralisation for later.
   Still money-adjacent: it changes what a committee prompt would assert.
3. **Do nothing until a Weekly tab is actually built.** Cheapest, and wrong — the trap is
   armed now and the next session has no reason to look.

## Recommendation

**Option 1**, with a caveat about ordering.

Option 2 looks tempting as a quick win, but "make them agree" requires knowing which
number is correct, which is the same sign-off option 1 needs. There is no cheaper path
that is still safe; the only thing option 2 saves is the storage work, and that work is
what stops the tenth constant from becoming an eleventh — and the tenth was already
there, unnoticed, when this OD was first written.

Ordering caveat: if the Weekly tab gets built before this is resolved, **option 2 becomes
urgent on its own**, because at that moment 12.075% stops being latent.

What I need from you to proceed — the same four values item 3 has been blocked on:

1. The correct rate, and the date it was verified.
2. Fixed, or floating with the broker's benchmark?
3. Store in `ips_lite`, or somewhere else?
4. When the as-of date is older than *N* days, should the app warn, refuse to build a
   prompt, or carry on silently? (I have no basis to pick *N*.)

## Decision

<!-- Filled in when resolved: what, by whom, when; link to the ADR/PR. -->
