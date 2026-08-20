# ADR-APP-005 — Standing merge policy (self-merge authority)

- **Status:** Accepted
- **Date:** 2026-08-19
- **Deciders:** Amir (product owner)
- **Money-adjacent:** No (governs process, not investment numbers)

## Context

The agent opens PRs; historically Amir merged every one. As the capability work
matured (foundation + Swing Score + outcome grading + IPS-lite, all against
Amir-signed-off ADRs), the merge step became the bottleneck for changes that carry
no new judgment. Amir delegated a bounded self-merge authority so routine,
already-approved work can land without waiting, while everything that needs his
judgment still hard-stops.

## Decision

### 1. Self-merge allowed (no waiting) — only when ALL hold
- The PR implements an **already-accepted ADR** or an **approved plan item**.
- It introduces **no money-adjacent number or logic beyond what Amir has already
  signed off** (in an accepted ADR).
- It **passes the full bun gate**: `bun install --frozen-lockfile` + `npx tsc --noEmit`
  clean + boot check (`/auth` 200).
- The agent **posts a one-line merge notice** Amir will see.

### 2. Hard-stop — requires Amir's explicit approval (never self-merge)
- Any **new money-adjacent number or logic** not already in an accepted ADR.
- Any change to the **committee's decision authority**.
- Anything touching **execution or external money movement**.
- **Any ADR itself** (proposing/accepting an ADR is Amir's call).

When blocked on one of these, the agent sends a **push notification** and **waits**
for Amir's decision (Remote Control). Questions are framed mobile-friendly: a short
question with numbered options where possible.

### 3. Dependabot
- The agent **may merge the grouped minor/patch PR** after running the full bun gate
  on it.
- **Hold all majors** — batch them for a maintenance pass; they are not blocking.

### 4. Production safety valve
- Amir keeps doing the **production glance after deploys**. If he flags a problem,
  **self-merge pauses** until it is discussed and cleared.

## Consequences

- Routine, pre-approved work lands quickly; Amir's attention is reserved for genuine
  judgment (money, authority, execution, ADRs).
- Every self-merge is traceable (one-line notice + the PR + the ADR/plan item it cites).
- This ADR itself was merged under Amir's explicit instruction; going forward, ADRs
  are hard-stopped per rule 2.
