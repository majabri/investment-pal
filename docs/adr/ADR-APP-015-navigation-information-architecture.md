# ADR-APP-015 — Navigation information architecture

- **Status:** Proposed
- **Date:** 2026-09-10
- **Deciders:** Amir (product owner), implementation agent
- **Money-adjacent:** No. Navigation moves nothing and computes nothing — but it
  decides what a person sees without looking for it, on a screen where the
  things not seen are positions and policy breaches.
- **Serves:** §5 of the 2026-09-10 audit brief

> **No navigation is changed by this ADR.** The brief says not to change it
> until the owner decides, and to record the outcome either way. This is the
> record and the options; the decision is not taken here.

## Context

The brief presents this as two different lists of seven:

| Blueprint §21.1 | `main` (`src/lib/nav.ts`) |
|---|---|
| Investment Office | Investment Office |
| Portfolio | Portfolio |
| Reports/Decisions | Decisions |
| Investment Universe | Research |
| Journal/Learning | Committee |
| Goals | Family |
| Settings | Settings |

Read that way it looks like a disagreement about four of seven entries. **It is
not.** Reading `nav.ts` rather than the section labels, three of the blueprint's
four "missing" entries are present as **tabs**, one level down:

| Blueprint wants top-level | Where it actually is on `main` |
|---|---|
| Investment Universe | `/watchlist` + `/opportunities`, tabs under **Research** |
| Goals | `/goals`, a tab under **Settings** |
| Journal/Learning | `/journal`, a tab under **Decisions** |

So the real conflict is **demotion, not absence** — plus two sections `main` has
that the blueprint does not describe at all:

- **Committee** (`/prompt-center`) — the prompt surface and the committee
  scorecard. This is how every recommendation in the app is produced.
- **Family** (`/kids`) — kids' trading accounts, two 529s, crypto, a separate
  watchlist and prompt centre. Real accounts with real balances.

That reframing matters, because "the blueprint has no Family section" is not a
finding that Family should go. It is a finding that the blueprint does not
describe the household this app is actually used by.

## What is genuinely at stake

Three questions, and only the first is close:

**Q1. Should Goals be top-level rather than a Settings tab?** The blueprint says
yes. The argument for: a goal is the thing every projection on the dashboard is
measured against, and burying it under Settings files it as configuration rather
than as the point. The argument against: it is edited rarely, and ADR-APP-014's
work has just given it version history — a thing you review, not a thing you
navigate to daily.

**Q2. Should Investment Universe be top-level rather than tabs under Research?**
The blueprint says yes, and Task 5 has just given the universe a real security
master, so it now has more substance than "a watchlist". Against: `Research`
already holds six tabs and is the section the AppShell comment specifically
notes has to scroll horizontally. Promoting two of them thins that out; it also
adds an eighth section to a bar sized for seven.

**Q3. Journal/Learning top-level?** Weakest of the three. The journal is a tab
beside the decisions it annotates, which is arguably where it belongs.

## Options

### A. Leave navigation as it is; amend the blueprint.

`main` reflects how the app is actually used, including two sections the
blueprint never described. Record that §21.1 is superseded on this point.

- **For.** Zero user-facing churn. Nothing is hidden — every blueprint entry is
  reachable, most in one tap. The two extra sections are real functionality.
- **Against.** The blueprint stops being a specification anyone can check
  navigation against, and the next audit re-raises this.

### B. Promote Goals only.

The single change with the clearest argument, leaving the six-tab Research
section and both extra sections alone.

- **For.** Smallest change that answers the strongest of the three questions.
  Goals becomes the eighth section, or swaps into Settings' slot with Settings
  demoted to the More menu.
- **Against.** Eight sections in a bar the AppShell already treats as full.

### C. Adopt the blueprint's seven, keeping Committee and Family.

Promote Investment Universe, Goals and Journal; that yields **nine** sections.

- **For.** The blueprint's intent is fully honoured.
- **Against.** Nine top-level sections on a phone is not an information
  architecture, it is a list. This is the option that looks most compliant and
  is worst to use.

### D. Restructure rather than promote.

Treat the count as the constraint and re-cut the sections — for example folding
Committee into Decisions (the committee produces decisions), which frees a slot
for Investment Universe or Goals without growing the bar.

- **For.** The only option that improves the architecture rather than
  rearranging it, and the only one that keeps seven.
- **Against.** The largest change, and it moves routes people have muscle memory
  for. It also needs a view on whether the Prompt Centre is a *place* or a
  *thing you do inside Decisions*, which nobody has stated.

## Recommendation, offered not taken

**B, and amend the blueprint for the rest.** Goals has the strongest case and
the smallest blast radius. Investment Universe's case improves once the security
master from Task 5 is actually live — which it is not yet, because the migration
has not been applied — so deciding it now would be deciding it on a table that
does not exist. Journal is weakest and should stay where it is.

D is the intellectually better answer and I am not recommending it, because it
turns a navigation question into a product question about what the Prompt Centre
is, and that is worth its own conversation rather than a paragraph in an ADR
about menu order.

## Consequences

- Under **A** or **B**, `docs/adr/` gains the record that §21.1 is partly
  superseded, and the next audit reads this instead of re-deriving it.
- Under **B**, `src/lib/nav.ts` gains a section and `MOBILE_PRIMARY` needs a
  view on what leaves the thumb-reach row. `nav.test.ts` pins the structure in
  seventeen tests and will need updating with it.
- Under **C** or **D**, every deep link and every `to=` in the app is in scope,
  and the change wants a boot check per route rather than per section.
- In all cases the two sections the blueprint does not describe — Committee and
  Family — stay. Their absence from §21.1 is a gap in the blueprint, not in the
  app.

## Not decided here

Whether the Prompt Centre is a place or an action. Whether `MOBILE_PRIMARY`
should be user-configurable, which would dissolve most of this question and
raises its own.
