# OD-004 — Whether the goal probability model should count monthly contributions

- **Status:** Approved 2026-09-18 — Option 1, "label it" (Amir Jabri, in chat)
- **Raised:** 2026-09-18
- **Area:** scope (a projection shown to the owner; not money movement)

## Context

Two figures sit side by side on the dashboard's Goal outlook and on `/goals`:

| Figure | Function | Counts monthly contributions? |
|---|---|---|
| Required CAGR | `requiredCAGRWithContrib` | **yes** |
| Probability of success | `probabilityOfReachingTarget` | **no** |

The probability is a log-normal projection of the *current value alone* to the
target date. A goal funded mostly by contributions therefore reads a lower
probability than the plan actually carries, while the required-CAGR figure
next to it already assumes those contributions arrive. The two figures answer
different questions and nothing on the screen says so.

This surfaced while fixing the "Probability of reaching the goal is 0%" alert
(PR: goal probability unknown ≠ zero). That fix is about *unknown*: the model
now returns NULL when it has nothing to project from, and a small probability
prints as a bound (`<1%`) rather than `0%`. It does **not** change the model.
Whether the model should count contributions is a modelling choice about a
figure the owner reads and the Committee is briefed with (`Model probability:`
in the prompt), so it is not the implementation's to take.

## Options

1. **Leave the model as is; label it.** The screen and the prompt say
   "current value only, contributions not counted". Cheapest; honest; the
   figure stays pessimistic for contribution-funded goals.
2. **Count contributions.** Project current value plus the contribution stream
   under the same log-normal (contributions compounding from when they land,
   or a simulation). The probability rises for contribution-funded goals and
   agrees with the required-CAGR figure's assumptions. Needs its own tests and
   a stated method.
3. **Show both.** "Without further contributions" and "with planned
   contributions" as two figures. Most informative; two numbers to explain.

## Recommendation

**Option 1 now, Option 2 or 3 if the owner wants the figure to mean the plan.**
Labelling costs nothing and stops the two figures being read as one story.
Changing the model is a real change to what the Committee is told about the
goal, and should be decided, not slipped in.

## Decision

**Option 1 — label it.** Amir Jabri, 2026-09-18, in chat: *"4 is label it"*, with
the three options above in front of him.

Recorded in code the same day: `PROBABILITY_BASIS` in `src/lib/finance.ts`
("Current value only; monthly contributions are not counted.") is shown under
the probability on the dashboard's Goal outlook and on `/goals`, and the
Committee brief's `Model probability:` line carries it in parentheses. The
model is unchanged. Options 2 and 3 remain available if the owner later wants
the figure to mean the plan; either would be a new OD or an ADR, not a quiet
change.
